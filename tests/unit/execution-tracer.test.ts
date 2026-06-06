import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createExecutionTracer } from "@opencode/engine/agents/execution-tracer.js";
import { createPipeline, createPipelineStep, createPipelineRun, getPipelineRuns, getPipelineStepRuns } from "@opencode/engine/agents/pipeline-store.js";
import { getDb } from "@opencode/engine/persistence/database.js";
import { agents, pipelineStepRuns, pipelineRuns, pipelineSteps, agentPipelines } from "@opencode/engine/persistence/schema.js";

function createTestAgent(id: string): void {
  const now = new Date().toISOString();
  getDb().insert(agents).values({
    id, name: id, goal: `Test agent ${id}`, mode: "planning",
    trigger: "manual", enabled: 1, createdAt: now, updatedAt: now,
  }).run();
}

function makeStep(pipelineId: string, agentId: string, order: number): ReturnType<typeof createPipelineStep> {
  return createPipelineStep({ pipelineId, agentId, stepOrder: order, dependsOn: "[]", inputMapping: null, outputKey: null });
}

describe("ExecutionTracer", () => {
  let tracer: ReturnType<typeof createExecutionTracer>;
  let pipeline: { id: string };

  beforeAll(() => {
    initTestDb();
    createTestAgent("trace-agent-1");
  });

  afterAll(() => cleanupTestDb());

  beforeEach(() => {
    const db = getDb();
    db.delete(pipelineStepRuns).run();
    db.delete(pipelineRuns).run();
    db.delete(pipelineSteps).run();
    db.delete(agentPipelines).run();
    tracer = createExecutionTracer();
    pipeline = createPipeline({ name: "Trace Pipeline" });
  });

  it("should record run start and complete", () => {
    const run = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 2 });
    tracer.onRunStart(pipeline.id, run.id, 2);

    const runs = getPipelineRuns(pipeline.id);
    const found = runs.find((r) => r.id === run.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe("running");
    expect(found!.stepsTotal).toBe(2);
    expect(found!.stepsCompleted).toBe(0);

    tracer.onRunComplete(run.id, "completed");
    const updated = getPipelineRuns(pipeline.id).find((r) => r.id === run.id);
    expect(updated!.status).toBe("completed");
  });

  it("should record step start, complete, and output", () => {
    const step = makeStep(pipeline.id, "trace-agent-1", 0);
    const run = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 1 });
    tracer.onRunStart(pipeline.id, run.id, 1);
    tracer.onStepStart(run.id, step, '{"test":"input"}');

    let steps = getPipelineStepRuns(run.id);
    expect(steps).toHaveLength(1);
    expect(steps[0].stepId).toBe(step.id);
    expect(steps[0].stepType).toBe("agent");
    expect(steps[0].input).toBe('{"test":"input"}');
    expect(steps[0].status).toBe("running");

    tracer.onStepComplete(run.id, step.id, "output-data");
    steps = getPipelineStepRuns(run.id);
    expect(steps[0].status).toBe("completed");
    expect(steps[0].output).toBe("output-data");
    expect(steps[0].finishedAt).toBeTruthy();
  });

  it("should record step failure with error", () => {
    const step = makeStep(pipeline.id, "trace-agent-1", 0);
    const run = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 1 });
    tracer.onRunStart(pipeline.id, run.id, 1);
    tracer.onStepStart(run.id, step, '{}');
    tracer.onStepFail(run.id, step.id, "Something went wrong");

    const steps = getPipelineStepRuns(run.id);
    expect(steps[0].status).toBe("failed");
    expect(steps[0].error).toBe("Something went wrong");
    expect(steps[0].finishedAt).toBeTruthy();
  });

  it("should classify and persist errorKind on step failure", () => {
    const step = makeStep(pipeline.id, "trace-agent-1", 0);
    const run = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 1 });
    tracer.onRunStart(pipeline.id, run.id, 1);
    tracer.onStepStart(run.id, step, '{}');

    tracer.onStepFail(run.id, step.id, "Operation timed out after 10000ms");
    const steps1 = getPipelineStepRuns(run.id);
    expect(steps1[0].errorKind).toBe("timeout");

    const step2 = makeStep(pipeline.id, "trace-agent-1", 1);
    tracer.onStepStart(run.id, step2, '{}');
    tracer.onStepFail(run.id, step2.id, "Tool 'websearch' not in pipeline allowlist");
    const steps2 = getPipelineStepRuns(run.id);
    expect(steps2[1].errorKind).toBe("tool_error");

    const step3 = makeStep(pipeline.id, "trace-agent-1", 2);
    tracer.onStepStart(run.id, step3, '{}');
    tracer.onStepFail(run.id, step3.id, "database corruption");
    const steps3 = getPipelineStepRuns(run.id);
    expect(steps3[2].errorKind).toBe("internal");
  });

  it("should record step skip with reason", () => {
    const step = makeStep(pipeline.id, "trace-agent-1", 0);
    const run = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 1 });
    tracer.onRunStart(pipeline.id, run.id, 1);
    tracer.onStepStart(run.id, step, '{}');
    tracer.onStepSkip(run.id, step.id, "Dependency abc failed");

    const steps = getPipelineStepRuns(run.id);
    expect(steps[0].status).toBe("skipped");
    expect(steps[0].error).toBe("Dependency abc failed");
    expect(steps[0].finishedAt).toBeTruthy();
  });

  it("should append log entries to step", () => {
    const step = makeStep(pipeline.id, "trace-agent-1", 0);
    const run = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 1 });
    tracer.onRunStart(pipeline.id, run.id, 1);
    tracer.onStepStart(run.id, step, '{}');
    tracer.onStepLog(run.id, step.id, "First log");
    tracer.onStepLog(run.id, step.id, "Second log");

    const steps = getPipelineStepRuns(run.id);
    const entries = JSON.parse(steps[0].log);
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe("First log");
    expect(entries[1].message).toBe("Second log");
    expect(entries[0].timestamp).toBeTruthy();
  });

  it("should handle empty pipeline (0 steps)", () => {
    const run = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 0 });
    tracer.onRunStart(pipeline.id, run.id, 0);
    tracer.onRunComplete(run.id, "completed");

    const runs = getPipelineRuns(pipeline.id).filter((r) => r.id === run.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].stepsTotal).toBe(0);
    const steps = getPipelineStepRuns(run.id);
    expect(steps).toHaveLength(0);
  });
});
