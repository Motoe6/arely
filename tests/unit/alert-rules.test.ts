import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { evaluateToolRule, evaluatePipelineRule, evaluateAlertRules, DEFAULT_ALERT_RULES } from "@arelyos/engine/agents/alert-rules.js";
import type { AlertRule, Alert } from "@arelyos/engine/agents/alert-rules.js";
import type { ToolMetric, PipelineMetric } from "@arelyos/engine/agents/pipeline-metrics.js";
import { getDb } from "@arelyos/engine/persistence/database.js";
import { agentPipelines, pipelineRuns, pipelineStepRuns } from "@arelyos/engine/persistence/schema.js";
import { ulid } from "ulid";

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

describe("Alert Rules", () => {
  beforeAll(() => initTestDb());
  afterAll(() => cleanupTestDb());

  beforeEach(() => {
    const db = getDb();
    db.delete(pipelineStepRuns).run();
    db.delete(pipelineRuns).run();
    db.delete(agentPipelines).run();
    vi.restoreAllMocks();
  });

  describe("evaluateToolRule", () => {
    it("generates alert when tool success rate is below threshold", () => {
      const rule: AlertRule = { id: "r1", name: "test", enabled: true, severity: "critical", category: "success_rate", target: "tool", operator: "<", threshold: 0.8 };
      const metrics: ToolMetric[] = [
        { toolName: "websearch", total: 10, successCount: 5, failureCount: 5, timeoutCount: 0, cancelledCount: 0, successRate: 0.5, avgDurationMs: 100, p95DurationMs: 200, avgRetries: 0, lastSeenAt: new Date().toISOString() },
      ];
      const alerts = evaluateToolRule(rule, metrics);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("critical");
      expect(alerts[0].target).toBe("websearch");
      expect(alerts[0].ruleId).toBe("r1");
    });

    it("generates no alert when success rate is above threshold", () => {
      const rule: AlertRule = { id: "r1", name: "test", enabled: true, severity: "critical", category: "success_rate", target: "tool", operator: "<", threshold: 0.8 };
      const metrics: ToolMetric[] = [
        { toolName: "websearch", total: 10, successCount: 9, failureCount: 1, timeoutCount: 0, cancelledCount: 0, successRate: 0.9, avgDurationMs: 100, p95DurationMs: 200, avgRetries: 0, lastSeenAt: new Date().toISOString() },
      ];
      expect(evaluateToolRule(rule, metrics)).toHaveLength(0);
    });

    it("skips tools with no attempts for success_rate", () => {
      const rule: AlertRule = { id: "r1", name: "test", enabled: true, severity: "critical", category: "success_rate", target: "tool", operator: "<", threshold: 0.8 };
      const metrics: ToolMetric[] = [
        { toolName: "unused", total: 0, successCount: 0, failureCount: 0, timeoutCount: 0, cancelledCount: 0, successRate: 0, avgDurationMs: 0, p95DurationMs: 0, avgRetries: 0, lastSeenAt: null },
      ];
      expect(evaluateToolRule(rule, metrics)).toHaveLength(0);
    });

    it("generates alert when timeout rate exceeds threshold", () => {
      const rule: AlertRule = { id: "r2", name: "test", enabled: true, severity: "critical", category: "timeout_rate", target: "tool", operator: ">", threshold: 0.4 };
      const metrics: ToolMetric[] = [
        { toolName: "websearch", total: 10, successCount: 5, failureCount: 5, timeoutCount: 3, cancelledCount: 0, successRate: 0.5, avgDurationMs: 100, p95DurationMs: 200, avgRetries: 0, lastSeenAt: new Date().toISOString() },
      ];
      const alerts = evaluateToolRule(rule, metrics);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].category).toBe("timeout_rate");
    });

    it("skips timeout_rate when failureCount is 0", () => {
      const rule: AlertRule = { id: "r2", name: "test", enabled: true, severity: "critical", category: "timeout_rate", target: "tool", operator: ">", threshold: 0.4 };
      const metrics: ToolMetric[] = [
        { toolName: "websearch", total: 10, successCount: 10, failureCount: 0, timeoutCount: 0, cancelledCount: 0, successRate: 1, avgDurationMs: 100, p95DurationMs: 200, avgRetries: 0, lastSeenAt: new Date().toISOString() },
      ];
      expect(evaluateToolRule(rule, metrics)).toHaveLength(0);
    });

    it("generates alert when avg retries exceeds threshold", () => {
      const rule: AlertRule = { id: "r3", name: "test", enabled: true, severity: "critical", category: "retry_rate", target: "tool", operator: ">", threshold: 4 };
      const metrics: ToolMetric[] = [
        { toolName: "websearch", total: 5, successCount: 3, failureCount: 2, timeoutCount: 0, cancelledCount: 0, successRate: 0.6, avgDurationMs: 100, p95DurationMs: 200, avgRetries: 4.5, lastSeenAt: new Date().toISOString() },
      ];
      const alerts = evaluateToolRule(rule, metrics);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].category).toBe("retry_rate");
    });

    it("generates alert when avg duration exceeds threshold", () => {
      const rule: AlertRule = { id: "r4", name: "test", enabled: true, severity: "critical", category: "duration", target: "tool", operator: ">", threshold: 10000 };
      const metrics: ToolMetric[] = [
        { toolName: "websearch", total: 5, successCount: 5, failureCount: 0, timeoutCount: 0, cancelledCount: 0, successRate: 1, avgDurationMs: 15000, p95DurationMs: 20000, avgRetries: 0, lastSeenAt: new Date().toISOString() },
      ];
      const alerts = evaluateToolRule(rule, metrics);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].category).toBe("duration");
    });

    it("uses >= operator correctly", () => {
      const rule: AlertRule = { id: "r5", name: "test", enabled: true, severity: "warning", category: "duration", target: "tool", operator: ">=", threshold: 100 };
      const metrics: ToolMetric[] = [
        { toolName: "websearch", total: 1, successCount: 1, failureCount: 0, timeoutCount: 0, cancelledCount: 0, successRate: 1, avgDurationMs: 100, p95DurationMs: 100, avgRetries: 0, lastSeenAt: new Date().toISOString() },
      ];
      const alerts = evaluateToolRule(rule, metrics);
      expect(alerts).toHaveLength(1);
    });
  });

  describe("evaluatePipelineRule", () => {
    it("generates alert when pipeline success rate is below threshold", () => {
      const rule: AlertRule = { id: "p1", name: "test", enabled: true, severity: "critical", category: "success_rate", target: "pipeline", operator: "<", threshold: 0.8 };
      const metrics: PipelineMetric[] = [
        { pipelineId: "pl_1", pipelineName: "My Pipeline", totalRuns: 10, completedRuns: 5, failedRuns: 5, avgRunDurationMs: 100, p95RunDurationMs: 200, avgStepsPerRun: 1 },
      ];
      const alerts = evaluatePipelineRule(rule, metrics);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].target).toBe("pl_1");
      expect(alerts[0].message).toContain("My Pipeline");
    });

    it("skips pipelines with no runs", () => {
      const rule: AlertRule = { id: "p1", name: "test", enabled: true, severity: "critical", category: "success_rate", target: "pipeline", operator: "<", threshold: 0.8 };
      const metrics: PipelineMetric[] = [
        { pipelineId: "pl_1", pipelineName: "Empty", totalRuns: 0, completedRuns: 0, failedRuns: 0, avgRunDurationMs: 0, p95RunDurationMs: 0, avgStepsPerRun: 0 },
      ];
      expect(evaluatePipelineRule(rule, metrics)).toHaveLength(0);
    });
  });

  describe("evaluateAlertRules integration", () => {
    it("returns empty alerts when no data", () => {
      const alerts = evaluateAlertRules(DEFAULT_ALERT_RULES);
      expect(alerts).toEqual([]);
    });

    it("returns alerts for underperforming tools", () => {
      const p = insertPipeline("P");
      const run = insertRun(p, "completed");
      insertStep(run, { status: "completed" });
      insertStep(run, { status: "failed", errorKind: "timeout" });
      insertStep(run, { status: "failed", errorKind: "timeout" });

      const alerts = evaluateAlertRules(DEFAULT_ALERT_RULES);
      // success_rate: 1 success / 3 attempts = 33% < 80% → alert
      // timeout_rate: 2 timeouts / 2 failures = 100% > 40% → alert
      const sr = alerts.find((a) => a.category === "success_rate");
      expect(sr).toBeDefined();
      expect(sr!.severity).toBe("critical");
      const tr = alerts.find((a) => a.category === "timeout_rate");
      expect(tr).toBeDefined();
      expect(tr!.severity).toBe("critical");
    });

    it("respects disabled rules", () => {
      const rules: AlertRule[] = [
        { id: "disabled", name: "disabled", enabled: false, severity: "critical", category: "success_rate", target: "tool", operator: "<", threshold: 1 },
      ];
      const p = insertPipeline("P");
      const run = insertRun(p, "completed");
      insertStep(run, { status: "failed", errorKind: "internal" });

      const alerts = evaluateAlertRules(rules);
      expect(alerts).toHaveLength(0);
    });
  });
});
