import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { ulid } from "ulid";
import { getDb } from "../../src/persistence/database.js";
import { agentPipelines, pipelineRuns, pipelineStepRuns } from "../../src/persistence/schema.js";
import { getOverviewMetrics, getToolMetrics, getPipelineMetrics, getErrorMetrics } from "../../src/agents/pipeline-metrics.js";

function insertPipeline(name: string): string {
  const id = ulid();
  const now = new Date().toISOString();
  getDb().insert(agentPipelines).values({ id, name, createdAt: now, updatedAt: now }).run();
  return id;
}

function insertRun(pipelineId: string, status: string, overrides: Record<string, unknown> = {}): string {
  const id = ulid();
  getDb().insert(pipelineRuns).values({ id, pipelineId, status: status as any, stepsTotal: 1, stepsCompleted: status === "completed" ? 1 : 0, ...overrides }).run();
  return id;
}

function insertStep(runId: string, overrides: Record<string, unknown> = {}): string {
  const id = ulid();
  getDb().insert(pipelineStepRuns).values({ id, runId, stepId: "s1", stepType: "tool", toolName: "websearch", status: "completed", retryCount: 0, log: "[]", ...overrides }).run();
  return id;
}

describe("Pipeline Metrics", () => {
  beforeAll(() => initTestDb());
  afterAll(() => cleanupTestDb());

  beforeEach(() => {
    const db = getDb();
    db.delete(pipelineStepRuns).run();
    db.delete(pipelineRuns).run();
    db.delete(agentPipelines).run();
  });

  it("returns zeroed metrics when DB is empty", () => {
    const m = getOverviewMetrics();
    expect(m.totalRuns).toBe(0);
    expect(m.completedRuns).toBe(0);
    expect(m.failedRuns).toBe(0);
    expect(m.totalStepRuns).toBe(0);
    expect(m.toolsCount).toBe(0);
    expect(m.pipelinesCount).toBe(0);
  });

  it("overview reflects a single completed run", () => {
    const p = insertPipeline("P");
    const run = insertRun(p, "completed", { stepsTotal: 3, startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:30.000Z" });
    insertStep(run);
    insertStep(run);
    insertStep(run);

    const m = getOverviewMetrics();
    expect(m.totalRuns).toBe(1);
    expect(m.completedRuns).toBe(1);
    expect(m.failedRuns).toBe(0);
    expect(m.totalStepRuns).toBe(3);
    expect(m.toolsCount).toBe(1);
    expect(m.pipelinesCount).toBe(1);
    expect(m.avgRunDurationMs).toBe(30000);
    expect(m.avgStepsPerRun).toBe(3);
  });

  it("overview excludes replay runs", () => {
    const p = insertPipeline("P");
    insertRun(p, "completed", { replayOf: ulid() });
    const normalRun = insertRun(p, "completed", { startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:01:00.000Z" });
    insertStep(normalRun);

    const m = getOverviewMetrics();
    expect(m.totalRuns).toBe(1);
    expect(m.completedRuns).toBe(1);
    expect(m.totalStepRuns).toBe(1);
  });

  it("tool metrics report status counts, successRate, and lastSeenAt", () => {
    const p = insertPipeline("P");
    const run = insertRun(p, "completed", { startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:01:00.000Z" });
    insertStep(run, { status: "completed", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:10.000Z" });
    insertStep(run, { status: "completed", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:20.000Z" });
    insertStep(run, { status: "failed", errorKind: "timeout", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:30.000Z" });
    insertStep(run, { status: "failed", errorKind: "internal", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:40.000Z" });
    insertStep(run, { status: "failed", errorKind: "cancelled", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:50.000Z" });

    const tools = getToolMetrics();
    expect(tools).toHaveLength(1);
    const t = tools[0];
    expect(t.toolName).toBe("websearch");
    expect(t.total).toBe(5);
    expect(t.successCount).toBe(2);
    expect(t.failureCount).toBe(3);
    expect(t.timeoutCount).toBe(1);
    expect(t.cancelledCount).toBe(1);
    expect(t.successRate).toBe(2 / 5);
    expect(t.lastSeenAt).toBe("2026-01-01T00:00:50.000Z");
  });

  it("tool metrics compute avgRetries per logical execution", () => {
    const p = insertPipeline("P");
    const run = insertRun(p, "completed", { stepsTotal: 2 });
    // Step s1: 3 attempts (retryCount 0, 1, 2)
    insertStep(run, { stepId: "s1", status: "failed", retryCount: 0 });
    insertStep(run, { stepId: "s1", status: "failed", retryCount: 1 });
    insertStep(run, { stepId: "s1", status: "completed", retryCount: 2, toolName: "websearch" });
    // Step s2: 1 attempt (retryCount 0)
    insertStep(run, { stepId: "s2", status: "completed", retryCount: 0, toolName: "websearch" });

    const tools = getToolMetrics();
    expect(tools).toHaveLength(1);
    // avgRetries = max(2,2) for s1 + max(0) for s2 = (2 + 0) / 2 = 1
    expect(tools[0].avgRetries).toBe(1);
  });

  it("tool metrics compute duration avg and p95", () => {
    const p = insertPipeline("P");
    const run = insertRun(p, "completed");
    insertStep(run, { startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z" });
    insertStep(run, { startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:02.000Z" });
    insertStep(run, { startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:03.000Z" });
    insertStep(run, { startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:04.000Z" });
    insertStep(run, { startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:05.000Z" });

    const tools = getToolMetrics();
    expect(tools).toHaveLength(1);
    // durations: [1000, 2000, 3000, 4000, 5000]
    // avg = 3000
    expect(tools[0].avgDurationMs).toBe(3000);
    // p95: idx = floor(5 * 0.95) = 4, sorted[4] = 5000
    expect(tools[0].p95DurationMs).toBe(5000);
  });

  it("tool metrics return successRate = 0 when no completed or failed", () => {
    const p = insertPipeline("P");
    const run = insertRun(p, "pending");
    insertStep(run, { status: "pending" });

    const tools = getToolMetrics();
    expect(tools).toHaveLength(1);
    expect(tools[0].successRate).toBe(0);
    expect(tools[0].total).toBe(1);
    expect(tools[0].successCount).toBe(0);
    expect(tools[0].failureCount).toBe(0);
  });

  it("pipeline metrics report per-pipeline aggregation", () => {
    const p1 = insertPipeline("Alpha");
    const p2 = insertPipeline("Beta");
    insertRun(p1, "completed", { stepsTotal: 3, startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:01:00.000Z" });
    insertRun(p1, "failed", { stepsTotal: 2, startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:30.000Z" });
    insertRun(p2, "completed", { stepsTotal: 5, startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:02:00.000Z" });

    const pipelines = getPipelineMetrics();
    expect(pipelines).toHaveLength(2);
    // Sorted by totalRuns DESC
    expect(pipelines[0].pipelineName).toBe("Alpha");
    expect(pipelines[0].totalRuns).toBe(2);
    expect(pipelines[0].completedRuns).toBe(1);
    expect(pipelines[0].failedRuns).toBe(1);
    expect(pipelines[0].avgRunDurationMs).toBe(45000);
    expect(pipelines[0].avgStepsPerRun).toBe(2.5);

    expect(pipelines[1].pipelineName).toBe("Beta");
    expect(pipelines[1].totalRuns).toBe(1);
    expect(pipelines[1].avgRunDurationMs).toBe(120000);
  });

  it("error metrics report distribution and percentage", () => {
    const p = insertPipeline("P");
    const run = insertRun(p, "failed");
    // 6 timeout, 4 internal = 10 total failures
    for (let i = 0; i < 6; i++) insertStep(run, { status: "failed", errorKind: "timeout" });
    for (let i = 0; i < 4; i++) insertStep(run, { status: "failed", errorKind: "internal" });

    const errors = getErrorMetrics();
    expect(errors).toHaveLength(2);
    expect(errors[0].errorKind).toBe("timeout");
    expect(errors[0].count).toBe(6);
    expect(errors[0].percentage).toBe(60);

    expect(errors[1].errorKind).toBe("internal");
    expect(errors[1].count).toBe(4);
    expect(errors[1].percentage).toBe(40);
  });

  it("error metrics returns empty array when no failures", () => {
    const p = insertPipeline("P");
    const run = insertRun(p, "completed");
    insertStep(run, { status: "completed" });

    const errors = getErrorMetrics();
    expect(errors).toEqual([]);
  });

  it("sorts tools by total DESC", () => {
    const p = insertPipeline("P");
    const run = insertRun(p, "completed");
    insertStep(run, { toolName: "most-used", status: "completed" });
    insertStep(run, { toolName: "most-used", status: "completed" });
    insertStep(run, { toolName: "least-used", status: "completed" });
    insertStep(run, { toolName: "middle", status: "completed" });
    insertStep(run, { toolName: "middle", status: "completed" });
    insertStep(run, { toolName: "middle", status: "completed" });

    const tools = getToolMetrics();
    expect(tools.map((t) => t.toolName)).toEqual(["middle", "most-used", "least-used"]);
  });

  it("treats null errorKind as unknown in error metrics", () => {
    const p = insertPipeline("P");
    const run = insertRun(p, "failed");
    insertStep(run, { status: "failed", errorKind: null });

    const errors = getErrorMetrics();
    expect(errors).toHaveLength(1);
    expect(errors[0].errorKind).toBe("unknown");
    expect(errors[0].count).toBe(1);
  });

  it("excludes rows without both timestamps from duration calculations", () => {
    const p = insertPipeline("P");
    const run = insertRun(p, "completed", { startedAt: "2026-01-01T00:00:00.000Z", completedAt: null });
    insertStep(run, { startedAt: null, finishedAt: "2026-01-01T00:00:10.000Z" });
    insertStep(run, { startedAt: "2026-01-01T00:00:00.000Z", finishedAt: null });

    const overview = getOverviewMetrics();
    expect(overview.avgRunDurationMs).toBe(0);

    const tools = getToolMetrics();
    expect(tools[0].avgDurationMs).toBe(0);
    expect(tools[0].p95DurationMs).toBe(0);
  });
});
