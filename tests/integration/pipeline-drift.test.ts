import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { ExecutionComparator } from "@arely/engine/agents/drift-analyzer.js";
import { createPipeline, createPipelineStep, createPipelineRun, updatePipelineRunStatus, getPipelineStepRuns } from "@arely/engine/agents/pipeline-store.js";
import { executePipeline } from "@arely/engine/agents/pipeline.js";
import { getDb } from "@arely/engine/persistence/database.js";
import { agents, pipelineStepRuns, pipelineRuns, pipelineSteps, agentPipelines } from "@arely/engine/persistence/schema.js";
import type { RuntimeConfig } from "@arely/engine/agents/runtime.js";
import { createExecutionTracer } from "@arely/engine/agents/execution-tracer.js";
import { createHash } from "node:crypto";

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

function createTestAgent(id: string): void {
  const now = new Date().toISOString();
  getDb().insert(agents).values({
    id, name: id, goal: `Test agent ${id}`, mode: "planning",
    trigger: "manual", enabled: 1, createdAt: now, updatedAt: now,
  }).run();
}

const toolOutputs: Record<string, string> = {};

function makeToolConfig(): RuntimeConfig {
  const captured: string[] = [];
  return {
    sessionManager: {} as any,
    llm: {} as any,
    executeTool: async (toolName: string, _args: Record<string, unknown>) => {
      captured.push(toolName);
      const result = toolOutputs[toolName] ?? `default-${toolName}`;
      return { content: result };
    },
    _captured: captured,
  } as RuntimeConfig & { _captured: string[] };
}

describe("Pipeline Drift Integration", () => {
  let comparator: ExecutionComparator;
  let pipeline: { id: string };

  beforeAll(() => {
    initTestDb();
    createTestAgent("drift-tool-agent");
    comparator = new ExecutionComparator();
  });

  afterAll(() => cleanupTestDb());

  beforeEach(() => {
    const db = getDb();
    db.delete(pipelineStepRuns).run();
    db.delete(pipelineRuns).run();
    db.delete(pipelineSteps).run();
    db.delete(agentPipelines).run();
    pipeline = createPipeline({ name: "Drift Test Pipeline" });
    Object.keys(toolOutputs).forEach((k) => delete toolOutputs[k]);
  });

  it("should detect zero drift when replay has no changes", async () => {
    const step1 = createPipelineStep({ pipelineId: pipeline.id, agentId: null, toolName: "drift_a", stepOrder: 0, type: "tool", dependsOn: "[]", inputMapping: null, outputKey: null });

    toolOutputs.drift_a = "stable-output";

    const config = makeToolConfig();
    const tracer = createExecutionTracer();
    const result = await executePipeline(pipeline.id, config, tracer);

    const report = comparator.compare(result.runId, result.runId);
    expect(report.driftCount).toBe(0);
    expect(report.summary.none).toBe(1);
  });

  it("should detect output_changed when replay produces different tool output", async () => {
    const step1 = createPipelineStep({ pipelineId: pipeline.id, agentId: null, toolName: "drift_b", stepOrder: 0, type: "tool", dependsOn: "[]", inputMapping: null, outputKey: null });

    toolOutputs.drift_b = "original-output";
    const configA = makeToolConfig();
    const tracerA = createExecutionTracer();
    const resultA = await executePipeline(pipeline.id, configA, tracerA);

    toolOutputs.drift_b = "different-output";
    const configB = makeToolConfig();
    const tracerB = createExecutionTracer();
    const resultB = await executePipeline(pipeline.id, configB, tracerB);

    const report = comparator.compare(resultA.runId, resultB.runId);
    expect(report.driftCount).toBe(1);
    expect(report.entries[0].kind).toBe("output_changed");

    const stepRunsA = getPipelineStepRuns(resultA.runId);
    const stepRunsB = getPipelineStepRuns(resultB.runId);
    expect(stepRunsA[0].toolOutputHash).toBe(sha256("original-output"));
    expect(stepRunsB[0].toolOutputHash).toBe(sha256("different-output"));
  });

  it("should detect step_missing when a step is removed between runs", async () => {
    const step1 = createPipelineStep({ pipelineId: pipeline.id, agentId: null, toolName: "drift_c", stepOrder: 0, type: "tool", dependsOn: "[]", inputMapping: null, outputKey: null });
    const step2 = createPipelineStep({ pipelineId: pipeline.id, agentId: null, toolName: "drift_d", stepOrder: 1, type: "tool", dependsOn: JSON.stringify([step1.id]), inputMapping: null, outputKey: null });

    toolOutputs.drift_c = "x";
    toolOutputs.drift_d = "y";
    const configA = makeToolConfig();
    const tracerA = createExecutionTracer();
    const resultA = await executePipeline(pipeline.id, configA, tracerA);

    // Run B: same pipeline but simulate only step1 (step2 was removed)
    const runB = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 1 });
    updatePipelineRunStatus(runB.id, "completed");
    const time = new Date().toISOString();
    getDb().insert(pipelineStepRuns).values({
      id: `sr-b-${step1.id}`, runId: runB.id, stepId: step1.id, stepType: "tool",
      agentId: null, toolName: "drift_c", status: "completed",
      input: "{}", output: "x", error: null,
      toolInputHash: sha256('{"dependsOn":"[]"}'), toolOutputHash: sha256("x"),
      startedAt: time, finishedAt: time, retryCount: 0, log: "[]",
    }).run();

    const report = comparator.compare(resultA.runId, runB.id);
    expect(report.summary.stepMissing).toBe(1);
    expect(report.summary.stepAdded).toBe(0);
    expect(report.driftCount).toBe(1);
  });

  it("should return valid DriftReport via compare API", () => {
    const runA = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 1 });
    updatePipelineRunStatus(runA.id, "completed");
    const runB = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 1 });
    updatePipelineRunStatus(runB.id, "completed");

    const time = new Date().toISOString();
    getDb().insert(pipelineStepRuns).values({
      id: "api-sr-a", runId: runA.id, stepId: "api-step", stepType: "tool",
      agentId: null, toolName: "test_tool", status: "completed",
      input: "{}", output: "out", error: null,
      toolInputHash: "h1", toolOutputHash: "h2",
      startedAt: time, finishedAt: time, retryCount: 0, log: "[]",
    }).run();
    getDb().insert(pipelineStepRuns).values({
      id: "api-sr-b", runId: runB.id, stepId: "api-step", stepType: "tool",
      agentId: null, toolName: "test_tool", status: "completed",
      input: "{}", output: "out2", error: null,
      toolInputHash: "h1", toolOutputHash: "h3",
      startedAt: time, finishedAt: time, retryCount: 0, log: "[]",
    }).run();

    const report = comparator.compare(runA.id, runB.id);
    expect(report.runAId).toBe(runA.id);
    expect(report.runBId).toBe(runB.id);
    expect(report.pipelineId).toBe(pipeline.id);
    expect(report.driftCount).toBe(1);
    expect(report.summary.outputChanged).toBe(1);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].kind).toBe("output_changed");
  });
});
