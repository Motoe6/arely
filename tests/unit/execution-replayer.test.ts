import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { ExecutionReplayer } from "@arely/engine/agents/execution-replayer.js";
import { createPipeline, createPipelineStep, createPipelineRun, updatePipelineRunStatus } from "@arely/engine/agents/pipeline-store.js";
import { getDb } from "@arely/engine/persistence/database.js";
import { agents, pipelineStepRuns, pipelineRuns, pipelineSteps, agentPipelines } from "@arely/engine/persistence/schema.js";

function createTestAgent(id: string): void {
  const now = new Date().toISOString();
  getDb().insert(agents).values({
    id, name: id, goal: `Test agent ${id}`, mode: "planning",
    trigger: "manual", enabled: 1, createdAt: now, updatedAt: now,
  }).run();
}

function insertStepRun(runId: string, stepId: string, status: string, output: string | null, order: number): void {
  const time = new Date(Date.now() + order * 1000).toISOString();
  getDb().insert(pipelineStepRuns).values({
    id: `sr-${stepId}`,
    runId,
    stepId,
    stepType: "tool",
    agentId: null,
    toolName: "test_tool",
    status,
    input: '{}',
    output,
    error: status === "failed" ? "error" : null,
    startedAt: time,
    finishedAt: status !== "running" ? time : null,
    retryCount: 0,
    log: "[]",
  }).run();
}

describe("ExecutionReplayer", () => {
  let replayer: ExecutionReplayer;
  let pipeline: { id: string };

  beforeAll(() => {
    initTestDb();
    createTestAgent("replay-agent-1");
  });

  afterAll(() => cleanupTestDb());

  beforeEach(() => {
    const db = getDb();
    db.delete(pipelineStepRuns).run();
    db.delete(pipelineRuns).run();
    db.delete(pipelineSteps).run();
    db.delete(agentPipelines).run();
    replayer = new ExecutionReplayer();
    pipeline = createPipeline({ name: "Replay Pipeline" });
  });

  it("should return error when original run is not found", async () => {
    const result = await replayer.replay(pipeline.id, "nonexistent-run", "step-1", {} as any);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Original run not found");
  });

  it("should return error when replayFrom step is not in pipeline", async () => {
    const step1 = createPipelineStep({ pipelineId: pipeline.id, agentId: "replay-agent-1", stepOrder: 0, dependsOn: "[]", inputMapping: null, outputKey: null });
    const run = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 1 });
    updatePipelineRunStatus(run.id, "completed");
    insertStepRun(run.id, step1.id, "completed", "output-1", 0);

    const result = await replayer.replay(pipeline.id, run.id, "nonexistent-step", {} as any);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Replay point step not found");
  });
});
