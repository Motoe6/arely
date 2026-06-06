import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createPipeline, createPipelineStep, getPipelineStepRuns } from "../../src/agents/pipeline-store.js";
import { executePipeline } from "../../src/agents/pipeline.js";
import { createExecutionTracer } from "../../src/agents/execution-tracer.js";
import { getDb } from "../../src/persistence/database.js";
import { pipelineStepRuns, pipelineRuns, pipelineSteps, agentPipelines, agents } from "../../src/persistence/schema.js";
import { TimeoutError } from "../../src/tools/errors.js";

vi.mock("../../src/agents/runtime.js", () => ({
  executeAgent: vi.fn(),
}));

import { executeAgent } from "../../src/agents/runtime.js";

const mockConfig = {
  sessionManager: {} as any,
  llm: {} as any,
  executeTool: vi.fn(),
};

describe("Pipeline Retry Behavior", () => {
  beforeAll(() => {
    initTestDb();
  });

  afterAll(() => cleanupTestDb());

  beforeEach(() => {
    vi.resetAllMocks();
    const db = getDb();
    db.delete(pipelineStepRuns).run();
    db.delete(pipelineRuns).run();
    db.delete(pipelineSteps).run();
    db.delete(agentPipelines).run();
  });

  it("should retry a tool step when it fails with a retryable error", async () => {
    const mockTools = vi.mocked(mockConfig.executeTool);
    mockTools
      .mockRejectedValueOnce(new TimeoutError("timed out"))
      .mockResolvedValueOnce({ content: "success on retry" });

    const pipeline = createPipeline({ name: "Retry Success" });
    createPipelineStep({
      pipelineId: pipeline.id,
      type: "tool",
      toolName: "websearch",
      stepOrder: 0,
      dependsOn: "[]",
      idempotent: true,
      retries: 1,
      retryDelayMs: 10,
      retryableErrors: ["timeout"],
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(true);
    expect(result.stepResults[0].status).toBe("completed");
    expect(mockTools).toHaveBeenCalledTimes(2);
  });

  it("should not retry when step is not idempotent", async () => {
    const mockTools = vi.mocked(mockConfig.executeTool);
    mockTools.mockRejectedValue(new TimeoutError("timed out"));

    const pipeline = createPipeline({ name: "Not Idempotent" });
    createPipelineStep({
      pipelineId: pipeline.id,
      type: "tool",
      toolName: "websearch",
      stepOrder: 0,
      dependsOn: "[]",
      idempotent: false,
      retries: 1,
      retryDelayMs: 10,
      retryableErrors: ["timeout"],
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(false);
    expect(result.stepResults[0].status).toBe("failed");
    expect(mockTools).toHaveBeenCalledTimes(1);
  });

  it("should not retry when error is not in retryableErrors list", async () => {
    const mockTools = vi.mocked(mockConfig.executeTool);
    mockTools.mockRejectedValue(new Error("something broke"));

    const pipeline = createPipeline({ name: "Non Retryable" });
    createPipelineStep({
      pipelineId: pipeline.id,
      type: "tool",
      toolName: "websearch",
      stepOrder: 0,
      dependsOn: "[]",
      idempotent: true,
      retries: 2,
      retryDelayMs: 10,
      retryableErrors: ["timeout", "tool_error"],
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(false);
    expect(result.stepResults[0].status).toBe("failed");
    expect(mockTools).toHaveBeenCalledTimes(1);
  });

  it("should propagate failure after all retries exhausted", async () => {
    const mockTools = vi.mocked(mockConfig.executeTool);
    mockTools.mockRejectedValue(new Error("persistent failure"));

    const pipeline = createPipeline({ name: "Exhausted" });
    createPipelineStep({
      pipelineId: pipeline.id,
      type: "tool",
      toolName: "websearch",
      stepOrder: 0,
      dependsOn: "[]",
      idempotent: true,
      retries: 2,
      retryDelayMs: 10,
      retryableErrors: ["internal"],
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(false);
    expect(result.stepResults[0].status).toBe("failed");
    expect(mockTools).toHaveBeenCalledTimes(3);
  });

  it("should trace each retry attempt with correct retryCount in DB", async () => {
    const mockTools = vi.mocked(mockConfig.executeTool);
    mockTools.mockRejectedValue(new Error("persistent failure"));

    const pipeline = createPipeline({ name: "Tracer Retries" });
    createPipelineStep({
      pipelineId: pipeline.id,
      type: "tool",
      toolName: "websearch",
      stepOrder: 0,
      dependsOn: "[]",
      idempotent: true,
      retries: 1,
      retryDelayMs: 10,
      retryableErrors: ["internal"],
    });

    const tracer = createExecutionTracer();
    await executePipeline(pipeline.id, mockConfig, tracer);

    const db = getDb();
    const stepRunRows = db.select().from(pipelineStepRuns).all();
    expect(stepRunRows.length).toBe(2);
    const retryCounts = stepRunRows.map((r) => r.retryCount).sort();
    expect(retryCounts).toEqual([0, 1]);
  });

  it("should use linear retry strategy", async () => {
    const mockTools = vi.mocked(mockConfig.executeTool);
    mockTools
      .mockRejectedValueOnce(new TimeoutError("attempt 1"))
      .mockRejectedValueOnce(new TimeoutError("attempt 2"))
      .mockRejectedValueOnce(new TimeoutError("attempt 3"))
      .mockResolvedValueOnce({ content: "success on retry 3" });

    const pipeline = createPipeline({ name: "Linear Strategy" });
    createPipelineStep({
      pipelineId: pipeline.id,
      type: "tool",
      toolName: "websearch",
      stepOrder: 0,
      dependsOn: "[]",
      idempotent: true,
      retries: 3,
      retryDelayMs: 10,
      retryStrategy: "linear",
      retryableErrors: ["timeout"],
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(true);
    expect(result.stepResults[0].status).toBe("completed");
    expect(mockTools).toHaveBeenCalledTimes(4);
  });

  it("should use exponential retry strategy", async () => {
    const mockTools = vi.mocked(mockConfig.executeTool);
    mockTools
      .mockRejectedValueOnce(new TimeoutError("attempt 1"))
      .mockRejectedValueOnce(new TimeoutError("attempt 2"))
      .mockResolvedValueOnce({ content: "success on retry 2" });

    const pipeline = createPipeline({ name: "Exponential Strategy" });
    createPipelineStep({
      pipelineId: pipeline.id,
      type: "tool",
      toolName: "websearch",
      stepOrder: 0,
      dependsOn: "[]",
      idempotent: true,
      retries: 2,
      retryDelayMs: 10,
      retryStrategy: "exponential",
      retryableErrors: ["timeout"],
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(true);
    expect(result.stepResults[0].status).toBe("completed");
    expect(mockTools).toHaveBeenCalledTimes(3);
  });

  it("should use exponential_jitter retry strategy", async () => {
    const mockTools = vi.mocked(mockConfig.executeTool);
    mockTools
      .mockRejectedValueOnce(new TimeoutError("attempt 1"))
      .mockRejectedValueOnce(new TimeoutError("attempt 2"))
      .mockResolvedValueOnce({ content: "success on retry 2" });

    const pipeline = createPipeline({ name: "Jitter Strategy" });
    createPipelineStep({
      pipelineId: pipeline.id,
      type: "tool",
      toolName: "websearch",
      stepOrder: 0,
      dependsOn: "[]",
      idempotent: true,
      retries: 2,
      retryDelayMs: 10,
      retryStrategy: "exponential_jitter",
      retryableErrors: ["timeout"],
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(true);
    expect(result.stepResults[0].status).toBe("completed");
    expect(mockTools).toHaveBeenCalledTimes(3);
  });

  it("should default to fixed when retryStrategy is null", async () => {
    const mockTools = vi.mocked(mockConfig.executeTool);
    mockTools
      .mockRejectedValueOnce(new TimeoutError("timed out"))
      .mockResolvedValueOnce({ content: "success on retry" });

    const pipeline = createPipeline({ name: "Null Strategy" });
    createPipelineStep({
      pipelineId: pipeline.id,
      type: "tool",
      toolName: "websearch",
      stepOrder: 0,
      dependsOn: "[]",
      idempotent: true,
      retries: 1,
      retryDelayMs: 10,
      retryableErrors: ["timeout"],
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(true);
    expect(result.stepResults[0].status).toBe("completed");
    expect(mockTools).toHaveBeenCalledTimes(2);
  });

  it("should preserve fixed strategy behavior (regression)", async () => {
    const mockTools = vi.mocked(mockConfig.executeTool);
    mockTools
      .mockRejectedValueOnce(new TimeoutError("timed out"))
      .mockResolvedValueOnce({ content: "success on retry" });

    const pipeline = createPipeline({ name: "Fixed Strategy" });
    createPipelineStep({
      pipelineId: pipeline.id,
      type: "tool",
      toolName: "websearch",
      stepOrder: 0,
      dependsOn: "[]",
      idempotent: true,
      retries: 1,
      retryDelayMs: 10,
      retryStrategy: "fixed",
      retryableErrors: ["timeout"],
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(true);
    expect(result.stepResults[0].status).toBe("completed");
    expect(mockTools).toHaveBeenCalledTimes(2);
  });

  it("should not retry agent steps even with retry contract fields set", async () => {
    vi.mocked(executeAgent).mockResolvedValue({ ok: false, error: "agent error" });

    const now = new Date().toISOString();
    getDb()
      .insert(agents)
      .values({ id: "test-agent-retry", name: "Retry Agent", goal: "test", mode: "planning", trigger: "manual", enabled: 1, createdAt: now, updatedAt: now })
      .run();

    const pipeline = createPipeline({ name: "Agent No Retry" });
    createPipelineStep({
      pipelineId: pipeline.id,
      agentId: "test-agent-retry",
      stepOrder: 0,
      dependsOn: "[]",
      idempotent: true,
      retries: 2,
      retryDelayMs: 10,
      retryableErrors: ["internal"],
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(false);
    expect(result.stepResults[0].status).toBe("failed");
    expect(executeAgent).toHaveBeenCalledTimes(1);
  });
});
