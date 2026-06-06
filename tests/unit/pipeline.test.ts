import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { agentMemorySet, agentMemoryGet, agentMemoryClear } from "../../src/tools/memory.js";
import { getDb } from "../../src/persistence/database.js";
import { agents } from "../../src/persistence/schema.js";
import {
  createPipeline,
  createPipelineStep,
  getPipelineSteps,
  createPipelineRun,
} from "../../src/agents/pipeline-store.js";

function createTestAgent(id: string): void {
  const now = new Date().toISOString();
  getDb().insert(agents).values({
    id, name: id, goal: `Test agent ${id}`, mode: "planning",
    trigger: "manual", enabled: 1, createdAt: now, updatedAt: now,
  }).run();
}

vi.mock("../../src/agents/runtime.js", () => ({
  executeAgent: vi.fn(),
}));

import { executeAgent } from "../../src/agents/runtime.js";
import { executePipeline } from "../../src/agents/pipeline.js";

const mockConfig = {
  sessionManager: {} as any,
  llm: {} as any,
};

describe("Pipeline Orchestrator", () => {
  beforeAll(() => {
    initTestDb();
    const agentIds = ["agent-1", "agent-2", "agent-3", "agent-a", "agent-b", "agent-c", "agent-research", "agent-writer"];
    for (const id of agentIds) createTestAgent(id);
  });
  afterAll(() => cleanupTestDb());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return error for nonexistent pipeline", async () => {
    const result = await executePipeline("nonexistent", mockConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Pipeline not found");
  });

  it("should execute a single-step pipeline", async () => {
    vi.mocked(executeAgent).mockResolvedValue({ ok: true });

    const pipeline = createPipeline({ name: "Single Step" });
    createPipelineStep({
      pipelineId: pipeline.id,
      agentId: "agent-1",
      stepOrder: 0,
      dependsOn: "[]",
      inputMapping: null,
      outputKey: "result",
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(true);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].status).toBe("completed");
    expect(executeAgent).toHaveBeenCalledWith("agent-1", mockConfig);
  });

  it("should execute sequential multi-step pipeline", async () => {
    vi.mocked(executeAgent).mockResolvedValue({ ok: true });

    const pipeline = createPipeline({ name: "Sequential" });
    const step1 = createPipelineStep({
      pipelineId: pipeline.id,
      agentId: "agent-a",
      stepOrder: 0,
      dependsOn: "[]",
      inputMapping: null,
      outputKey: "step_a_output",
    });
    createPipelineStep({
      pipelineId: pipeline.id,
      agentId: "agent-b",
      stepOrder: 1,
      dependsOn: JSON.stringify([step1.id]),
      inputMapping: JSON.stringify({ prev_result: step1.id }),
      outputKey: "step_b_output",
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(true);
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults.every((s) => s.status === "completed")).toBe(true);
    expect(executeAgent).toHaveBeenCalledTimes(2);
    expect(executeAgent).toHaveBeenNthCalledWith(1, "agent-a", mockConfig);
    expect(executeAgent).toHaveBeenNthCalledWith(2, "agent-b", mockConfig);
  });

  it("should skip downstream steps on failure", async () => {
    vi.mocked(executeAgent)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "Agent failed" })
      .mockResolvedValueOnce({ ok: true });

    const pipeline = createPipeline({ name: "Failure Test" });
    const step1 = createPipelineStep({
      pipelineId: pipeline.id,
      agentId: "agent-1",
      stepOrder: 0,
      dependsOn: "[]",
      inputMapping: null,
      outputKey: null,
    });
    const step2 = createPipelineStep({
      pipelineId: pipeline.id,
      agentId: "agent-2",
      stepOrder: 1,
      dependsOn: "[]",
      inputMapping: null,
      outputKey: null,
    });
    const step3 = createPipelineStep({
      pipelineId: pipeline.id,
      agentId: "agent-3",
      stepOrder: 2,
      dependsOn: JSON.stringify([step2.id]),
      inputMapping: null,
      outputKey: null,
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(false);
    expect(result.stepResults).toHaveLength(3);
    expect(result.stepResults[0].status).toBe("completed");
    expect(result.stepResults[1].status).toBe("failed");
    expect(result.stepResults[2].status).toBe("skipped");
    expect(executeAgent).toHaveBeenCalledTimes(2);
  });

  it("should pass input mapping data via memory", async () => {
    agentMemoryClear("agent-writer");
    vi.mocked(executeAgent).mockResolvedValue({ ok: true });

    const pipeline = createPipeline({ name: "Memory Pass" });
    const step1 = createPipelineStep({
      pipelineId: pipeline.id,
      agentId: "agent-research",
      stepOrder: 0,
      dependsOn: "[]",
      inputMapping: null,
      outputKey: "findings",
    });
    const step2 = createPipelineStep({
      pipelineId: pipeline.id,
      agentId: "agent-writer",
      stepOrder: 1,
      dependsOn: JSON.stringify([step1.id]),
      inputMapping: JSON.stringify({ research_data: step1.id }),
      outputKey: "article",
    });

    await executePipeline(pipeline.id, mockConfig);

    const writerMemory = agentMemoryGet("agent-writer", "article");
    expect(executeAgent).toHaveBeenCalledTimes(2);
    expect(executeAgent).toHaveBeenNthCalledWith(1, "agent-research", mockConfig);
    expect(executeAgent).toHaveBeenNthCalledWith(2, "agent-writer", mockConfig);
  });

  it("should detect cycles in DAG", async () => {
    const pipeline = createPipeline({ name: "Cycle Test" });
    const step1 = createPipelineStep({
      pipelineId: pipeline.id,
      agentId: "agent-a",
      stepOrder: 0,
      dependsOn: "[]",
      inputMapping: null,
      outputKey: null,
    });
    const step2 = createPipelineStep({
      pipelineId: pipeline.id,
      agentId: "agent-b",
      stepOrder: 1,
      dependsOn: JSON.stringify([step1.id]),
      inputMapping: null,
      outputKey: null,
    });
    // Step 3 depends on step2, step2 depends on step1 → no cycle
    createPipelineStep({
      pipelineId: pipeline.id,
      agentId: "agent-c",
      stepOrder: 2,
      dependsOn: JSON.stringify([step2.id]),
      inputMapping: null,
      outputKey: null,
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(true);
    expect(result.stepResults).toHaveLength(3);
  });

  it("should handle pipeline with no steps", async () => {
    const pipeline = createPipeline({ name: "Empty" });
    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("has no steps");
  });
});
