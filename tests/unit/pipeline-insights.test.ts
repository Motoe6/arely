import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { ulid } from "ulid";
import { getDb } from "@arelyos/engine/persistence/database.js";
import { agentPipelines, pipelineRuns, pipelineStepRuns } from "@arelyos/engine/persistence/schema.js";
import type { ReliabilityInsight } from "@arelyos/engine/agents/pipeline-insights.js";

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

// Import after mocks
import { getAllInsights, analyzeToolMetrics, analyzePipelineMetrics } from "@arelyos/engine/agents/pipeline-insights.js";
import type { ToolMetric, PipelineMetric } from "@arelyos/engine/agents/pipeline-metrics.js";

describe("Pipeline Insights", () => {
  beforeAll(() => initTestDb());
  afterAll(() => cleanupTestDb());

  beforeEach(() => {
    const db = getDb();
    db.delete(pipelineStepRuns).run();
    db.delete(pipelineRuns).run();
    db.delete(agentPipelines).run();
  });

  it("returns score 100 and empty insights when no data", () => {
    const result = getAllInsights();
    expect(result.score).toBe(100);
    expect(result.insights).toEqual([]);
  });

  it("generates critical insight for low success rate (< 0.8)", () => {
    const p = insertPipeline("P");
    const run = insertRun(p, "completed");
    insertStep(run, { status: "completed" });
    insertStep(run, { status: "failed", errorKind: "internal" });
    insertStep(run, { status: "failed", errorKind: "internal" });

    const result = getAllInsights();
    expect(result.score).toBeLessThan(100);
    const sr = result.insights.find((i) => i.category === "success_rate");
    expect(sr).toBeDefined();
    expect(sr!.severity).toBe("critical");
    expect(sr!.targetId).toBe("websearch");
  });

  it("generates warning insight for success rate < 0.9", () => {
    const metrics: ToolMetric[] = [
      { toolName: "websearch", total: 10, successCount: 9, failureCount: 1, timeoutCount: 0, cancelledCount: 0, successRate: 0.9, avgDurationMs: 100, p95DurationMs: 200, avgRetries: 0, lastSeenAt: new Date().toISOString() },
    ];
    const insights = analyzeToolMetrics(metrics);
    const sr = insights.find((i) => i.category === "success_rate");
    expect(sr).toBeDefined();
    expect(sr!.severity).toBe("info");
  });

  it("generates info insight for success rate < 0.95", () => {
    const metrics: ToolMetric[] = [
      { toolName: "websearch", total: 20, successCount: 19, failureCount: 1, timeoutCount: 0, cancelledCount: 0, successRate: 0.95, avgDurationMs: 100, p95DurationMs: 200, avgRetries: 0, lastSeenAt: new Date().toISOString() },
    ];
    const insights = analyzeToolMetrics(metrics);
    const sr = insights.find((i) => i.category === "success_rate");
    expect(sr).toBeUndefined();
  });

  it("generates critical insight for high timeout rate (> 0.4)", () => {
    const metrics: ToolMetric[] = [
      { toolName: "websearch", total: 10, successCount: 5, failureCount: 5, timeoutCount: 3, cancelledCount: 0, successRate: 0.5, avgDurationMs: 100, p95DurationMs: 200, avgRetries: 0, lastSeenAt: new Date().toISOString() },
    ];
    const insights = analyzeToolMetrics(metrics);
    const tr = insights.find((i) => i.category === "timeout_rate");
    expect(tr).toBeDefined();
    expect(tr!.severity).toBe("critical");
  });

  it("generates warning insight for avg retries > 2", () => {
    const metrics: ToolMetric[] = [
      { toolName: "websearch", total: 5, successCount: 3, failureCount: 2, timeoutCount: 0, cancelledCount: 0, successRate: 0.6, avgDurationMs: 100, p95DurationMs: 200, avgRetries: 2.5, lastSeenAt: new Date().toISOString() },
    ];
    const insights = analyzeToolMetrics(metrics);
    const rr = insights.find((i) => i.category === "retry_rate");
    expect(rr).toBeDefined();
    expect(rr!.severity).toBe("warning");
  });

  it("generates info insight for avg duration > 2000ms", () => {
    const metrics: ToolMetric[] = [
      { toolName: "websearch", total: 5, successCount: 5, failureCount: 0, timeoutCount: 0, cancelledCount: 0, successRate: 1, avgDurationMs: 3000, p95DurationMs: 5000, avgRetries: 0, lastSeenAt: new Date().toISOString() },
    ];
    const insights = analyzeToolMetrics(metrics);
    const dr = insights.find((i) => i.category === "duration");
    expect(dr).toBeDefined();
    expect(dr!.severity).toBe("info");
  });

  it("generates usage insight when tool never used", () => {
    const metrics: ToolMetric[] = [
      { toolName: "websearch", total: 0, successCount: 0, failureCount: 0, timeoutCount: 0, cancelledCount: 0, successRate: 0, avgDurationMs: 0, p95DurationMs: 0, avgRetries: 0, lastSeenAt: null },
    ];
    const insights = analyzeToolMetrics(metrics);
    const ur = insights.find((i) => i.category === "usage");
    expect(ur).toBeDefined();
    expect(ur!.severity).toBe("info");
    expect(ur!.message).toBe("Tool has never been used");
  });

  it("generates usage insight when tool not seen in 30+ days", () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const metrics: ToolMetric[] = [
      { toolName: "websearch", total: 10, successCount: 10, failureCount: 0, timeoutCount: 0, cancelledCount: 0, successRate: 1, avgDurationMs: 100, p95DurationMs: 200, avgRetries: 0, lastSeenAt: oldDate },
    ];
    const insights = analyzeToolMetrics(metrics);
    const ur = insights.find((i) => i.category === "usage");
    expect(ur).toBeDefined();
    expect(ur!.severity).toBe("info");
  });

  it("generates pipeline insight for low success rate", () => {
    const p = insertPipeline("Unreliable");
    // 7 completed, 3 failed → success rate = 0.7 < 0.8 → critical
    for (let i = 0; i < 7; i++) insertRun(p, "completed", { stepsTotal: 1 });
    for (let i = 0; i < 3; i++) insertRun(p, "failed", { stepsTotal: 1 });

    const result = getAllInsights();
    const pi = result.insights.find((i) => i.targetType === "pipeline");
    expect(pi).toBeDefined();
    expect(pi!.severity).toBe("critical");
    expect(pi!.category).toBe("success_rate");
    expect(pi!.targetId).toBe(p);
  });

  it("sorts insights by severity then category then tool", () => {
    // alpha: 0% success (critical), 100% timeout (critical) → 2 critical
    // beta:  50% success (critical), avgRetries=3 (warning) → 1 critical + 1 warning
    const metrics: ToolMetric[] = [
      { toolName: "alpha", total: 2, successCount: 0, failureCount: 2, timeoutCount: 2, cancelledCount: 0, successRate: 0, avgDurationMs: 100, p95DurationMs: 200, avgRetries: 0, lastSeenAt: null },
      { toolName: "beta", total: 2, successCount: 1, failureCount: 1, timeoutCount: 0, cancelledCount: 0, successRate: 0.5, avgDurationMs: 100, p95DurationMs: 200, avgRetries: 3, lastSeenAt: null },
    ];
    const insights = analyzeToolMetrics(metrics);
    expect(insights.length).toBeGreaterThanOrEqual(4);

    // Build ordered ranks for validation
    const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    const ranks = insights.map((i) => ({
      sev: sevOrder[i.severity] ?? 99,
      cat: i.category,
      targetId: i.targetId,
    }));

    for (let i = 1; i < ranks.length; i++) {
      const a = ranks[i - 1];
      const b = ranks[i];
      if (a.sev < b.sev) continue;
      expect(a.sev).toBeLessThanOrEqual(b.sev);
      if (a.sev === b.sev) {
        if (a.cat < b.cat) continue;
        expect(a.cat.localeCompare(b.cat)).toBeLessThanOrEqual(0);
        if (a.cat === b.cat) {
          expect(a.targetId.localeCompare(b.targetId)).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it("computes correct score with multiple insights", () => {
    const p = insertPipeline("P");
    const run = insertRun(p, "completed");
    // 1 critical (success_rate), 1 warning (retry), 1 info (duration)
    insertStep(run, { status: "completed" });
    insertStep(run, { status: "failed", errorKind: "internal" });
    insertStep(run, { status: "failed", errorKind: "internal" });

    const result = getAllInsights();
    // at minimum: critical success_rate, warning success_rate, info retry_rate
    const criticals = result.insights.filter((i) => i.severity === "critical").length;
    const warnings = result.insights.filter((i) => i.severity === "warning").length;
    const infos = result.insights.filter((i) => i.severity === "info").length;
    const expectedScore = Math.max(0, 100 - criticals * 25 - warnings * 10 - infos * 2);
    expect(result.score).toBe(expectedScore);
  });
});
