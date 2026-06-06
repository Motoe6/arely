import { describe, it, expect } from "vitest";
import { ImpactAnalyzer, type ImpactReport } from "@opencode/engine/agents/policy/impact-analyzer.js";
import { SimulationEngine, type AuditStorePort } from "@opencode/engine/agents/simulation/simulation-engine.js";
import type { PolicyPackStore } from "@opencode/engine/agents/policy/policy-pack.js";
import type { PolicyRule } from "@opencode/engine/agents/policy/policy-types.js";
import type { PolicyRecommendation, RecommendationType } from "@opencode/engine/agents/policy/policy-recommender.js";
import type { PolicyAuditEvent } from "@opencode/engine/persistence/policy-audit-store.js";

function makeRule(id: string, overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id,
    when: {},
    then: { type: "trigger_remediation", payload: {} },
    cooldownMs: 60000,
    maxExecutionsPerHour: 10,
    ...overrides,
  };
}

function makeTraceEvent(eventType: string, matchedRuleIds: string[], metrics: Record<string, number> = {}): PolicyAuditEvent {
  return {
    id: `evt-${eventType}-${Math.random().toString(36).slice(2, 8)}`,
    traceId: "trace-1",
    eventType,
    payload: {
      metrics,
      circuitBreakerStates: {},
      actions: matchedRuleIds.map((ruleId) => ({ ruleId, action: "trigger_remediation", payload: {} })),
    },
    createdAt: "2026-06-01T00:00:00.000Z",
  };
}

function recommend(type: RecommendationType, ruleId: string, packId = "p", evidence: Record<string, unknown> = {}): PolicyRecommendation {
  return {
    type,
    severity: "medium",
    packId,
    ruleId,
    title: "test",
    description: "test",
    evidence,
    suggestedAction: "test",
  };
}

function makePackStore(packs: Array<{ id: string; rules: PolicyRule[] }>): PolicyPackStore {
  const map = new Map(packs.map((p) => [
    p.id,
    { id: p.id, name: p.id, description: "", rules: p.rules, createdAt: "", updatedAt: "" },
  ]));
  return {
    list: () => [...map.values()],
    get: (id: string) => map.get(id),
    create: () => { throw new Error("not impl"); },
    update: () => undefined,
    delete: () => false,
  };
}

function makeTraceLister(traces: Array<{ traceId: string }>): { listTraces: (limit?: number, offset?: number) => { traceId: string }[] } {
  return { listTraces: () => traces };
}

function makeAuditPort(traceMap: Map<string, PolicyAuditEvent[]>): AuditStorePort {
  return { getTrace: (traceId: string) => traceMap.get(traceId) ?? [] };
}

function makeEngine(auditPort: AuditStorePort): SimulationEngine {
  return new SimulationEngine(auditPort);
}

describe("ImpactAnalyzer", () => {
  describe("dead_rule", () => {
    it("should report zero impact when removing a truly dead rule", () => {
      const rules = [makeRule("active", { when: { successRate: { lt: 0.9 } } }), makeRule("dead", { when: { successRate: { lt: 0 } } })];
      const store = makePackStore([{ id: "p", rules }]);
      const traceMap = new Map<string, PolicyAuditEvent[]>();
      traceMap.set("t1", [makeTraceEvent("cycle_started", ["active"], { successRate: 0.85 })]);
      traceMap.set("t2", [makeTraceEvent("cycle_started", ["active"], { successRate: 0.95 })]);
      const engine = makeEngine(makeAuditPort(traceMap));
      const lister = makeTraceLister([{ traceId: "t1" }, { traceId: "t2" }]);
      const analyzer = new ImpactAnalyzer(store, engine, lister);
      const report = analyzer.validate(recommend("dead_rule", "dead"));
      expect(report.impactScore).toBe(0);
      expect(report.actionDelta).toBe(0);
      expect(report.addedRules).toHaveLength(0);
      expect(report.removedRules).toHaveLength(0);
    });

    it("should detect impact when removing an active rule", () => {
      const rules = [makeRule("r1", { when: { successRate: { lt: 0.9 } } }), makeRule("r2", { when: { retryRate: { gt: 0.1 } } })];
      const store = makePackStore([{ id: "p", rules }]);
      const traceMap = new Map<string, PolicyAuditEvent[]>();
      traceMap.set("t1", [makeTraceEvent("cycle_started", ["r1", "r2"], { successRate: 0.85, retryRate: 0.2 })]);
      traceMap.set("t2", [makeTraceEvent("cycle_started", ["r1"], { successRate: 0.7, retryRate: 0.05 })]);
      const engine = makeEngine(makeAuditPort(traceMap));
      const lister = makeTraceLister([{ traceId: "t1" }, { traceId: "t2" }]);
      const analyzer = new ImpactAnalyzer(store, engine, lister);
      const report = analyzer.validate(recommend("dead_rule", "r2"));
      expect(report.impactScore).toBeGreaterThan(0);
      expect(report.actionDelta).toBeLessThan(0);
      expect(report.removedRules).toContain("r2");
    });
  });

  describe("underperforming_rule", () => {
    it("should increase match rate when relaxing thresholds", () => {
      const rules = [makeRule("strict", { when: { retryRate: { gt: 0.5 } } })];
      const store = makePackStore([{ id: "p", rules }]);
      const traceMap = new Map<string, PolicyAuditEvent[]>();
      traceMap.set("t1", [makeTraceEvent("cycle_started", [], { retryRate: 0.3 })]);
      traceMap.set("t2", [makeTraceEvent("cycle_started", [], { retryRate: 0.4 })]);
      traceMap.set("t3", [makeTraceEvent("cycle_started", ["strict"], { retryRate: 0.6 })]);
      const engine = makeEngine(makeAuditPort(traceMap));
      const lister = makeTraceLister([{ traceId: "t1" }, { traceId: "t2" }, { traceId: "t3" }]);
      const analyzer = new ImpactAnalyzer(store, engine, lister);
      const report = analyzer.validate(recommend("underperforming_rule", "strict"));
      expect(report.simulatedTotalActions).toBeGreaterThan(report.originalTotalActions);
      expect(report.simulatedMatchRate).toBeLessThan(report.originalMatchRate);
    });
  });

  describe("threshold_tuning", () => {
    it("should adjust match rate when tuning a threshold", () => {
      const rules = [makeRule("r1", { when: { retryRate: { lt: 0.1 } } })];
      const store = makePackStore([{ id: "p", rules }]);
      const traceMap = new Map<string, PolicyAuditEvent[]>();
      traceMap.set("t1", [makeTraceEvent("cycle_started", [], { retryRate: 0.15 })]);
      traceMap.set("t2", [makeTraceEvent("cycle_started", ["r1"], { retryRate: 0.05 })]);
      traceMap.set("t3", [makeTraceEvent("cycle_started", [], { retryRate: 0.12 })]);
      const engine = makeEngine(makeAuditPort(traceMap));
      const lister = makeTraceLister([{ traceId: "t1" }, { traceId: "t2" }, { traceId: "t3" }]);
      const analyzer = new ImpactAnalyzer(store, engine, lister);
      const report = analyzer.validate(recommend("threshold_tuning", "r1", "p", {
        metric: "retryRate",
        thresholdLt: 0.1,
        observedMax: 0.15,
        observedMin: 0.05,
      }));
      expect(report.impactScore).toBeGreaterThanOrEqual(0);
      expect(report.tracesSucceeded).toBe(3);
    });

    it("should skip when evidence lacks metric", () => {
      const rules = [makeRule("r1", { when: { retryRate: { lt: 0.1 } } })];
      const store = makePackStore([{ id: "p", rules }]);
      const engine = makeEngine(makeAuditPort(new Map()));
      const lister = makeTraceLister([]);
      const analyzer = new ImpactAnalyzer(store, engine, lister);
      const report = analyzer.validate(recommend("threshold_tuning", "r1", "p", {}));
      expect(report.warnings).toHaveLength(1);
    });
  });

  describe("rule_conflict", () => {
    it("should simulate with one rule removed and add warning", () => {
      const rules = [makeRule("r1", { when: { retryRate: { gt: 0.1 } } }), makeRule("r2", { when: { retryRate: { lt: 0.5 } } })];
      const store = makePackStore([{ id: "p", rules }]);
      const traceMap = new Map<string, PolicyAuditEvent[]>();
      traceMap.set("t1", [makeTraceEvent("cycle_started", ["r1", "r2"], { retryRate: 0.3 })]);
      const engine = makeEngine(makeAuditPort(traceMap));
      const lister = makeTraceLister([{ traceId: "t1" }]);
      const analyzer = new ImpactAnalyzer(store, engine, lister);
      const report = analyzer.validate(recommend("rule_conflict", "r1"));
      expect(report.warnings).toHaveLength(1);
      expect(report.warnings[0]).toContain("manual rule selection");
    });
  });

  describe("confidence", () => {
    it("should be high with 100+ successful traces", () => {
      const rules = [makeRule("r1")];
      const store = makePackStore([{ id: "p", rules }]);
      const traceMap = new Map<string, PolicyAuditEvent[]>();
      const summaries: Array<{ traceId: string }> = [];
      for (let i = 0; i < 100; i++) {
        const tid = `t${i}`;
        traceMap.set(tid, [makeTraceEvent("cycle_started", [], {})]);
        summaries.push({ traceId: tid });
      }
      const engine = makeEngine(makeAuditPort(traceMap));
      const lister = makeTraceLister(summaries);
      const analyzer = new ImpactAnalyzer(store, engine, lister);
      const report = analyzer.validate(recommend("dead_rule", "r1"));
      expect(report.confidence).toBe("high");
    });

    it("should be low with fewer than 25 traces", () => {
      const store = makePackStore([{ id: "p", rules: [makeRule("r1")] }]);
      const traceMap = new Map<string, PolicyAuditEvent[]>();
      traceMap.set("t1", [makeTraceEvent("cycle_started", [], {})]);
      const engine = makeEngine(makeAuditPort(traceMap));
      const lister = makeTraceLister([{ traceId: "t1" }]);
      const analyzer = new ImpactAnalyzer(store, engine, lister);
      const report = analyzer.validate(recommend("dead_rule", "r1"));
      expect(report.confidence).toBe("low");
    });
  });

  describe("edge cases", () => {
    it("should return empty report for unknown pack", () => {
      const store = makePackStore([]);
      const engine = makeEngine(makeAuditPort(new Map()));
      const lister = makeTraceLister([]);
      const analyzer = new ImpactAnalyzer(store, engine, lister);
      const report = analyzer.validate(recommend("dead_rule", "r1", "nonexistent"));
      expect(report.tracesRequested).toBe(0);
      expect(report.warnings).toHaveLength(1);
      expect(report.warnings[0]).toContain("not found");
    });

    it("should return empty report when no traces available", () => {
      const store = makePackStore([{ id: "p", rules: [makeRule("r1")] }]);
      const engine = makeEngine(makeAuditPort(new Map()));
      const lister = makeTraceLister([]);
      const analyzer = new ImpactAnalyzer(store, engine, lister);
      const report = analyzer.validate(recommend("dead_rule", "r1"));
      expect(report.tracesRequested).toBe(0);
      expect(report.warnings).toHaveLength(1);
    });

    it("should accept explicit traceIds", () => {
      const rules = [makeRule("r1")];
      const store = makePackStore([{ id: "p", rules }]);
      const traceMap = new Map<string, PolicyAuditEvent[]>();
      traceMap.set("custom-1", [makeTraceEvent("cycle_started", [], {})]);
      const engine = makeEngine(makeAuditPort(traceMap));
      const lister = makeTraceLister([]);
      const analyzer = new ImpactAnalyzer(store, engine, lister);
      const report = analyzer.validate(recommend("dead_rule", "r1"), ["custom-1"]);
      expect(report.tracesRequested).toBe(1);
    });
  });

  describe("validateAll", () => {
    it("should validate multiple recommendations", () => {
      const store = makePackStore([{ id: "p", rules: [makeRule("r1")] }]);
      const engine = makeEngine(makeAuditPort(new Map()));
      const lister = makeTraceLister([]);
      const analyzer = new ImpactAnalyzer(store, engine, lister);
      const recs = [recommend("dead_rule", "r1"), recommend("dead_rule", "r2")];
      const reports = analyzer.validateAll(recs);
      expect(reports).toHaveLength(2);
      reports.forEach((r) => expect(r.tracesRequested).toBe(0));
    });
  });
});
