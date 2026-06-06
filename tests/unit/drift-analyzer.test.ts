import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { ExecutionComparator } from "../../src/agents/drift-analyzer.js";
import type { DriftKind } from "../../src/agents/drift-analyzer.js";
import { createPipeline, createPipelineRun, updatePipelineRunStatus } from "../../src/agents/pipeline-store.js";
import { getDb } from "../../src/persistence/database.js";
import { agents, pipelineStepRuns, pipelineRuns, pipelineSteps, agentPipelines } from "../../src/persistence/schema.js";

function insertStepRun(data: {
  runId: string;
  stepId: string;
  status: string;
  inputHash: string | null;
  outputHash: string | null;
  order: number;
  stepType?: string;
}): void {
  const time = new Date(Date.now() + data.order * 1000).toISOString();
  getDb().insert(pipelineStepRuns).values({
    id: `sr-${data.runId}-${data.stepId}`,
    runId: data.runId,
    stepId: data.stepId,
    stepType: data.stepType ?? "tool",
    agentId: null,
    toolName: "test_tool",
    status: data.status,
    input: "{}",
    output: null,
    error: null,
    toolInputHash: data.inputHash,
    toolOutputHash: data.outputHash,
    startedAt: time,
    finishedAt: time,
    retryCount: 0,
    log: "[]",
  }).run();
}

function makeRun(pipelineId: string): { id: string } {
  const run = createPipelineRun({ pipelineId, stepsTotal: 0 });
  updatePipelineRunStatus(run.id, "completed");
  return run;
}

describe("ExecutionComparator", () => {
  let comparator: ExecutionComparator;
  let pipeline: { id: string };
  let pipelineB: { id: string };

  beforeAll(() => {
    initTestDb();
    const now = new Date().toISOString();
    getDb().insert(agents).values({
      id: "drift-agent", name: "drift-agent", goal: "test", mode: "planning",
      trigger: "manual", enabled: 1, createdAt: now, updatedAt: now,
    }).run();
  });

  afterAll(() => cleanupTestDb());

  beforeEach(() => {
    const db = getDb();
    db.delete(pipelineStepRuns).run();
    db.delete(pipelineRuns).run();
    db.delete(pipelineSteps).run();
    db.delete(agentPipelines).run();
    comparator = new ExecutionComparator();
    pipeline = createPipeline({ name: "Drift Pipeline" });
    pipelineB = createPipeline({ name: "Other Pipeline" });
  });

  it("should throw when run A is not found", () => {
    expect(() => comparator.compare("nonexistent", "any")).toThrow("Run A not found");
  });

  it("should throw when run B is not found", () => {
    const runA = makeRun(pipeline.id);
    expect(() => comparator.compare(runA.id, "nonexistent")).toThrow("Run B not found");
  });

  it("should throw when runs belong to different pipelines", () => {
    const runA = makeRun(pipeline.id);
    const runB = makeRun(pipelineB.id);
    expect(() => comparator.compare(runA.id, runB.id)).toThrow("Cannot compare runs from different pipelines");
  });

  it("should return all none when comparing a run to itself", () => {
    const run = makeRun(pipeline.id);
    insertStepRun({ runId: run.id, stepId: "step-1", status: "completed", inputHash: "a1", outputHash: "b1", order: 0 });

    const report = comparator.compare(run.id, run.id);
    expect(report.driftCount).toBe(0);
    expect(report.summary.none).toBe(1);
    expect(report.summary.inputChanged).toBe(0);
    expect(report.summary.outputChanged).toBe(0);
    expect(report.summary.statusChanged).toBe(0);
    expect(report.entries[0].kind).toBe("none");
  });

  it("should detect input_changed when input hash differs (even if output also differs)", () => {
    const runA = makeRun(pipeline.id);
    const runB = makeRun(pipeline.id);
    insertStepRun({ runId: runA.id, stepId: "step-1", status: "completed", inputHash: "a1", outputHash: "b1", order: 0 });
    insertStepRun({ runId: runB.id, stepId: "step-1", status: "completed", inputHash: "a2", outputHash: "b2", order: 0 });

    const report = comparator.compare(runA.id, runB.id);
    expect(report.driftCount).toBe(1);
    expect(report.entries[0].kind).toBe("input_changed");
  });

  it("should detect output_changed when only output hash differs", () => {
    const runA = makeRun(pipeline.id);
    const runB = makeRun(pipeline.id);
    insertStepRun({ runId: runA.id, stepId: "step-1", status: "completed", inputHash: "a1", outputHash: "b1", order: 0 });
    insertStepRun({ runId: runB.id, stepId: "step-1", status: "completed", inputHash: "a1", outputHash: "b2", order: 0 });

    const report = comparator.compare(runA.id, runB.id);
    expect(report.driftCount).toBe(1);
    expect(report.entries[0].kind).toBe("output_changed");
  });

  it("should detect status_changed even when hashes also differ", () => {
    const runA = makeRun(pipeline.id);
    const runB = makeRun(pipeline.id);
    insertStepRun({ runId: runA.id, stepId: "step-1", status: "completed", inputHash: "a1", outputHash: "b1", order: 0 });
    insertStepRun({ runId: runB.id, stepId: "step-1", status: "failed", inputHash: "a2", outputHash: "b2", order: 0 });

    const report = comparator.compare(runA.id, runB.id);
    expect(report.driftCount).toBe(1);
    expect(report.entries[0].kind).toBe("status_changed");
  });

  it("should detect step_added and step_missing", () => {
    const runA = makeRun(pipeline.id);
    const runB = makeRun(pipeline.id);
    insertStepRun({ runId: runA.id, stepId: "step-1", status: "completed", inputHash: "a1", outputHash: "b1", order: 0 });
    insertStepRun({ runId: runB.id, stepId: "step-2", status: "completed", inputHash: "a1", outputHash: "b1", order: 0 });

    const report = comparator.compare(runA.id, runB.id);
    const kinds = report.entries.map((e) => e.kind);
    expect(kinds).toContain("step_missing");
    expect(kinds).toContain("step_added");
    expect(report.summary.stepMissing).toBe(1);
    expect(report.summary.stepAdded).toBe(1);
    expect(report.driftCount).toBe(2);
  });

  it("should build correct driftCount from summary", () => {
    const runA = makeRun(pipeline.id);
    const runB = makeRun(pipeline.id);
    insertStepRun({ runId: runA.id, stepId: "s1", status: "completed", inputHash: "a1", outputHash: "b1", order: 0 });
    insertStepRun({ runId: runA.id, stepId: "s2", status: "completed", inputHash: "a1", outputHash: "b1", order: 1 });
    insertStepRun({ runId: runB.id, stepId: "s1", status: "completed", inputHash: "a1", outputHash: "b1", order: 0 });
    insertStepRun({ runId: runB.id, stepId: "s2", status: "completed", inputHash: "a1", outputHash: "b2", order: 1 });

    const report = comparator.compare(runA.id, runB.id);
    expect(report.entries).toHaveLength(2);
    expect(report.summary.none).toBe(1);
    expect(report.summary.outputChanged).toBe(1);
    expect(report.driftCount).toBe(
      report.summary.inputChanged + report.summary.outputChanged + report.summary.statusChanged +
      report.summary.stepMissing + report.summary.stepAdded,
    );
    expect(report.driftCount).toBe(1);
  });
});
