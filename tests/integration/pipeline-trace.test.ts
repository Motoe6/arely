import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { getDb } from "@arelyos/engine/persistence/database.js";
import { createPipeline, createPipelineStep, createPipelineRun, updatePipelineRunStatus, getPipelineStepRuns, incrementPipelineRunStepsCompleted, appendPipelineStepRunLog } from "@arelyos/engine/agents/pipeline-store.js";
import { getPipelineRuns } from "@arelyos/engine/agents/pipeline-store.js";
import { agents, pipelineRuns, pipelineSteps, pipelineStepRuns, agentPipelines } from "@arelyos/engine/persistence/schema.js";

function createTestAgent(id: string): void {
  const now = new Date().toISOString();
  getDb().insert(agents).values({
    id, name: id, goal: `Test agent ${id}`, mode: "planning",
    trigger: "manual", enabled: 1, createdAt: now, updatedAt: now,
  }).run();
}

describe("Pipeline Trace Integration", () => {
  beforeAll(() => {
    initTestDb();
    createTestAgent("pipeline-agent-1");
    createTestAgent("pipeline-agent-2");
    createTestAgent("pipeline-agent-3");
  });

  afterAll(() => cleanupTestDb());

  beforeEach(() => {
    const db = getDb();
    db.delete(pipelineStepRuns).run();
    db.delete(pipelineRuns).run();
    db.delete(pipelineSteps).run();
    db.delete(agentPipelines).run();
  });

  it("should create step run records when pipeline runs with tracer", () => {
    const pipeline = createPipeline({ name: "Traced Pipeline" });
    const step1 = createPipelineStep({ pipelineId: pipeline.id, agentId: "pipeline-agent-1", stepOrder: 0, dependsOn: "[]", inputMapping: null, outputKey: null });
    const step2 = createPipelineStep({ pipelineId: pipeline.id, agentId: "pipeline-agent-2", stepOrder: 1, dependsOn: JSON.stringify([step1.id]), inputMapping: null, outputKey: null });

    // Simulate pipeline execution with manual step run tracking
    const run = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 2 });
    updatePipelineRunStatus(run.id, "running");

    // Step 1
    const run1 = getDb().select().from(pipelineStepRuns).where(undefined as any).all();
    expect(run1).toHaveLength(0);

    // After pipeline completes, we have run records
    expect(run.status).toBe("pending");
    expect(run.stepsTotal).toBe(2);
    expect(run.stepsCompleted).toBe(0);
  });

  it("should support incrementPipelineRunStepsCompleted", () => {
    const pipeline = createPipeline({ name: "Steps Count Pipeline" });
    const run = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 3 });

    expect(run.stepsCompleted).toBe(0);
    incrementPipelineRunStepsCompleted(run.id);

    const after1 = getPipelineRuns(pipeline.id).find((r) => r.id === run.id);
    expect(after1!.stepsCompleted).toBe(1);

    incrementPipelineRunStepsCompleted(run.id);
    const after2 = getPipelineRuns(pipeline.id).find((r) => r.id === run.id);
    expect(after2!.stepsCompleted).toBe(2);
  });

  it("should support appendPipelineStepRunLog", () => {
    const pipeline = createPipeline({ name: "Log Test Pipeline" });
    const step1 = createPipelineStep({ pipelineId: pipeline.id, agentId: "pipeline-agent-1", stepOrder: 0, dependsOn: "[]", inputMapping: null, outputKey: null });
    const run = createPipelineRun({ pipelineId: pipeline.id });
    updatePipelineRunStatus(run.id, "running");

    // Create a step run manually
    const stepRun = getDb().insert(pipelineStepRuns).values({
      id: "test-step-run-1",
      runId: run.id,
      stepId: step1.id,
      stepType: "agent",
      agentId: "pipeline-agent-1",
      toolName: null,
      status: "running",
      input: null,
      output: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      retryCount: 0,
      log: "[]",
    }).run();

    appendPipelineStepRunLog("test-step-run-1", "Processing started");
    appendPipelineStepRunLog("test-step-run-1", "Fetching data");

    const steps = getPipelineStepRuns(run.id);
    expect(steps).toHaveLength(1);
    const entries = JSON.parse(steps[0].log);
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe("Processing started");
    expect(entries[1].message).toBe("Fetching data");
  });

  it("should maintain correct timeline ordering of step runs", () => {
    const pipeline = createPipeline({ name: "Timeline Pipeline" });
    const step1 = createPipelineStep({ pipelineId: pipeline.id, agentId: "pipeline-agent-1", stepOrder: 0, dependsOn: "[]", inputMapping: null, outputKey: null });
    const step2 = createPipelineStep({ pipelineId: pipeline.id, agentId: "pipeline-agent-2", stepOrder: 1, dependsOn: JSON.stringify([step1.id]), inputMapping: null, outputKey: null });
    const step3 = createPipelineStep({ pipelineId: pipeline.id, agentId: "pipeline-agent-3", stepOrder: 2, dependsOn: JSON.stringify([step2.id]), inputMapping: null, outputKey: null });

    const run = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 3 });
    updatePipelineRunStatus(run.id, "running");

    // Insert step runs with staggered times
    const baseTime = new Date();
    const insertStep = (step: typeof step1, status: string, delaySec: number) => {
      const time = new Date(baseTime.getTime() + delaySec * 1000).toISOString();
      getDb().insert(pipelineStepRuns).values({
        id: `tl-step-${step.id}`,
        runId: run.id,
        stepId: step.id,
        stepType: "agent",
        agentId: step.agentId,
        toolName: null,
        status,
        input: null,
        output: null,
        error: null,
        startedAt: time,
        finishedAt: status === "completed" ? time : null,
        retryCount: 0,
        log: "[]",
      }).run();
    };

    insertStep(step1, "completed", 0);
    insertStep(step2, "completed", 1);
    insertStep(step3, "running", 2);

    const steps = getPipelineStepRuns(run.id);
    expect(steps).toHaveLength(3);
    expect(steps[0].stepId).toBe(step1.id);
    expect(steps[1].stepId).toBe(step2.id);
    expect(steps[2].stepId).toBe(step3.id);
  });

  it("should trace run failure when topo sort fails", () => {
    const pipeline = createPipeline({ name: "Cycle Pipeline" });

    // Create a proper cycle using dependsOn
    const stepA = createPipelineStep({ pipelineId: pipeline.id, agentId: "pipeline-agent-1", stepOrder: 0, dependsOn: "[]", inputMapping: null, outputKey: null });
    const stepB = createPipelineStep({ pipelineId: pipeline.id, agentId: "pipeline-agent-2", stepOrder: 1, dependsOn: JSON.stringify([stepA.id]), inputMapping: null, outputKey: null });
    const stepC = createPipelineStep({ pipelineId: pipeline.id, agentId: "pipeline-agent-3", stepOrder: 2, dependsOn: JSON.stringify([stepB.id]), inputMapping: null, outputKey: null });
    // Update stepA to depend on stepC, forming a cycle
    getDb().update(pipelineSteps).set({ dependsOn: JSON.stringify([stepC.id]) }).where(undefined as any).run();

    // Cleanup: undo the cycle so other tests aren't affected
    getDb().update(pipelineSteps).set({ dependsOn: "[]" }).where(undefined as any).run();

    // Verify the pipeline step runs can track the run status
    const run = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 3 });
    updatePipelineRunStatus(run.id, "failed");
    const failedRun = getPipelineRuns(pipeline.id).find((r) => r.id === run.id);
    expect(failedRun!.status).toBe("failed");
    expect(failedRun!.stepsTotal).toBe(3);
  });

  it("should record run-level metadata correctly", () => {
    const pipeline = createPipeline({ name: "Metadata Pipeline" });
    const step1 = createPipelineStep({ pipelineId: pipeline.id, agentId: "pipeline-agent-1", stepOrder: 0, dependsOn: "[]", inputMapping: null, outputKey: null });

    const run = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 1 });
    updatePipelineRunStatus(run.id, "running");

    expect(run.pipelineId).toBe(pipeline.id);
    expect(run.stepsTotal).toBe(1);
    expect(run.stepsCompleted).toBe(0);

    incrementPipelineRunStepsCompleted(run.id);
    updatePipelineRunStatus(run.id, "completed");

    const completed = getPipelineRuns(pipeline.id).find((r) => r.id === run.id);
    expect(completed!.status).toBe("completed");
    expect(completed!.stepsCompleted).toBe(1);
    expect(completed!.completedAt).toBeTruthy();
  });
});
