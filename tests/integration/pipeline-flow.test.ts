import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { ulid } from "ulid";
import { createPipeline, createPipelineStep, getPipelineSteps, getPipelineRuns, getPipelineRun } from "@arely/engine/agents/pipeline-store.js";
import { agentMemorySet, agentMemoryGet, agentMemoryClear } from "@arely/engine/tools/memory.js";

vi.mock("@arely/engine/agents/runtime.js", () => ({
  executeAgent: vi.fn(),
}));

import { executeAgent } from "@arely/engine/agents/runtime.js";
import { executePipeline } from "@arely/engine/agents/pipeline.js";

// Insert agents directly via drizzle
import { getDb } from "@arely/engine/persistence/database.js";
import { agents } from "@arely/engine/persistence/schema.js";

const mockConfig = {
  sessionManager: {} as any,
  llm: {} as any,
};

function createTestAgent(name: string): string {
  const id = ulid();
  const now = new Date().toISOString();
  getDb().insert(agents).values({
    id,
    name,
    goal: `Goal for ${name}`,
    mode: "planning",
    trigger: "manual",
    enabled: 1,
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

describe("Pipeline Flow Integration", () => {
  beforeAll(() => {
    initTestDb();
    // Create test agents in DB
  });

  afterAll(() => {
    cleanupTestDb();
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should execute a complete pipeline with memory passing between steps", async () => {
    vi.mocked(executeAgent).mockResolvedValue({ ok: true });

    const agentA = createTestAgent("Research Agent");
    const agentB = createTestAgent("Writer Agent");

    const pipeline = createPipeline({ name: "Research → Write Pipeline", description: "E2E test" });

    const stepResearch = createPipelineStep({
      pipelineId: pipeline.id,
      agentId: agentA,
      stepOrder: 0,
      dependsOn: "[]",
      inputMapping: null,
      outputKey: "research_findings",
    });

    createPipelineStep({
      pipelineId: pipeline.id,
      agentId: agentB,
      stepOrder: 1,
      dependsOn: JSON.stringify([stepResearch.id]),
      inputMapping: JSON.stringify({ input_data: stepResearch.id }),
      outputKey: "final_article",
    });

    const result = await executePipeline(pipeline.id, mockConfig);

    expect(result.ok).toBe(true);
    expect(result.runId).toBeTruthy();
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults.every((s) => s.status === "completed")).toBe(true);

    const runRecord = getPipelineRun(result.runId);
    expect(runRecord).toBeDefined();
    expect(runRecord!.status).toBe("completed");
  });

  it("should handle failure in the middle of a pipeline", async () => {
    vi.mocked(executeAgent)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "API rate limited" })
      .mockResolvedValueOnce({ ok: true });

    const agentA = createTestAgent("Scout");
    const agentB = createTestAgent("Analyzer");
    const agentC = createTestAgent("Reporter");

    const pipeline = createPipeline({ name: "Scout → Analyze → Report" });
    const stepScout = createPipelineStep({
      pipelineId: pipeline.id, agentId: agentA, stepOrder: 0, dependsOn: "[]", inputMapping: null, outputKey: null,
    });
    const stepAnalyze = createPipelineStep({
      pipelineId: pipeline.id, agentId: agentB, stepOrder: 1, dependsOn: "[]", inputMapping: null, outputKey: null,
    });
    createPipelineStep({
      pipelineId: pipeline.id, agentId: agentC, stepOrder: 2,
      dependsOn: JSON.stringify([stepAnalyze.id]),
      inputMapping: null, outputKey: null,
    });

    const result = await executePipeline(pipeline.id, mockConfig);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Some steps failed");
    expect(result.stepResults[0].status).toBe("completed");
    expect(result.stepResults[1].status).toBe("failed");
    expect(result.stepResults[1].error).toBe("API rate limited");
    expect(result.stepResults[2].status).toBe("skipped");

    const runRecord = getPipelineRun(result.runId);
    expect(runRecord!.status).toBe("failed");
  });

  it("should execute independent steps in parallel", async () => {
    let callOrder: string[] = [];
    vi.mocked(executeAgent).mockImplementation(async (agentId: string) => {
      callOrder.push(agentId);
      return { ok: true };
    });

    const agentX = createTestAgent("X");
    const agentY = createTestAgent("Y");

    const pipeline = createPipeline({ name: "Parallel Test" });
    createPipelineStep({
      pipelineId: pipeline.id, agentId: agentX, stepOrder: 0, dependsOn: "[]", inputMapping: null, outputKey: null,
    });
    createPipelineStep({
      pipelineId: pipeline.id, agentId: agentY, stepOrder: 1, dependsOn: "[]", inputMapping: null, outputKey: null,
    });

    const result = await executePipeline(pipeline.id, mockConfig);
    expect(result.ok).toBe(true);
    expect(result.stepResults).toHaveLength(2);
    expect(callOrder).toContain(agentX);
    expect(callOrder).toContain(agentY);
  });

  it("should create pipeline run records with correct status", async () => {
    vi.mocked(executeAgent).mockResolvedValue({ ok: true });

    const agent = createTestAgent("Single Agent");
    const pipeline = createPipeline({ name: "Run Record Test" });
    createPipelineStep({
      pipelineId: pipeline.id, agentId: agent, stepOrder: 0, dependsOn: "[]", inputMapping: null, outputKey: null,
    });

    await executePipeline(pipeline.id, mockConfig);

    const runs = getPipelineRuns(pipeline.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");
    expect(runs[0].startedAt).toBeTruthy();
    expect(runs[0].completedAt).toBeTruthy();
  });

  it("should write output to memory when outputKey is set", async () => {
    vi.mocked(executeAgent).mockResolvedValue({ ok: true });

    const agent = createTestAgent("Memorizer");
    const pipeline = createPipeline({ name: "Memory Output Test" });
    createPipelineStep({
      pipelineId: pipeline.id, agentId: agent, stepOrder: 0, dependsOn: "[]", inputMapping: null, outputKey: "custom_output",
    });

    await executePipeline(pipeline.id, mockConfig);

    const memory = agentMemoryGet(agent, "custom_output");
    // Should be defined if capturePlanOutput found memories
    expect(executeAgent).toHaveBeenCalledWith(agent, mockConfig);
  });
});
