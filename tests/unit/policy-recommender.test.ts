import { describe, it, expect } from "vitest";
import { PolicyRecommender, type RecommenderAuditPort, type TraceEvent } from "../../src/agents/policy/policy-recommender.js";
import type { PolicyPackStore } from "../../src/agents/policy/policy-pack.js";
import type { PolicyRule } from "../../src/agents/policy/policy-types.js";

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

function makeTrace(
  traceId: string,
  matchedRuleIds: string[],
  metrics: Record<string, number> = {},
): TraceEvent[] {
  return [
    {
      traceId,
      eventType: "cycle_started",
      payload: {
        metrics,
        circuitBreakerStates: {},
        actions: matchedRuleIds.map((ruleId) => ({ ruleId, action: "trigger_remediation", payload: {} })),
      },
      createdAt: "2026-06-01T00:00:00.000Z",
    },
  ];
}

function makeEmptyPackStore(): PolicyPackStore {
  return {
    list: () => [],
    get: () => undefined,
    create: () => { throw new Error("not implemented"); },
    update: () => undefined,
    delete: () => false,
  };
}

function makePackStore(packs: Array<{ id: string; rules: PolicyRule[] }>): PolicyPackStore {
  const rules: PolicyRule[] = [];
  const map = new Map(packs.map((p) => {
    rules.push(...p.rules);
    return [p.id, { id: p.id, name: p.id, description: "", rules: p.rules, createdAt: "", updatedAt: "" }];
  }));
  return {
    list: () => [...map.values()],
    get: (id: string) => map.get(id),
    create: () => { throw new Error("not implemented"); },
    update: () => undefined,
    delete: () => false,
  };
}

function makeAuditPort(traces: TraceEvent[][]): RecommenderAuditPort {
  const map = new Map<string, TraceEvent[]>();
  const summaries: Array<{ traceId: string; createdAt: string; eventCount: number }> = [];
  for (const events of traces) {
    const traceId = events[0]?.traceId ?? `unknown-${Math.random()}`;
    map.set(traceId, events);
    summaries.push({ traceId, createdAt: "2026-06-01T00:00:00.000Z", eventCount: events.length });
  }
  return {
    listTraces: (_limit?: number, _offset?: number) => summaries,
    countTraces: () => summaries.length,
    getTrace: (traceId: string) => map.get(traceId) ?? [],
  };
}

describe("PolicyRecommender", () => {
  describe("dead_rule detection", () => {
    it("should flag a rule that never matched", () => {
      const store = makePackStore([{ id: "pack1", rules: [makeRule("active"), makeRule("dead")] }]);
      const audit = makeAuditPort([
        makeTrace("t1", ["active"], { successRate: 0.95 }),
        makeTrace("t2", ["active"], { successRate: 0.98 }),
      ]);
      const r = new PolicyRecommender(store, audit);
      const recs = r.analyzeAll();
      const dead = recs.filter((x) => x.type === "dead_rule");
      expect(dead).toHaveLength(1);
      expect(dead[0].ruleId).toBe("dead");
      expect(dead[0].packId).toBe("pack1");
    });

    it("should not flag rules when all have matched", () => {
      const store = makePackStore([{ id: "p", rules: [makeRule("r1"), makeRule("r2")] }]);
      const audit = makeAuditPort([
        makeTrace("t1", ["r1", "r2"]),
      ]);
      const r = new PolicyRecommender(store, audit);
      expect(r.analyzeAll().filter((x) => x.type === "dead_rule")).toHaveLength(0);
    });

    it("should return empty when there are no traces", () => {
      const store = makePackStore([{ id: "p", rules: [makeRule("r1")] }]);
      const audit = makeAuditPort([]);
      const r = new PolicyRecommender(store, audit);
      expect(r.analyzeAll()).toHaveLength(0);
    });
  });

  describe("underperforming_rule detection", () => {
    it("should flag a rule that matches below the threshold", () => {
      const store = makePackStore([{ id: "p", rules: [makeRule("rare"), makeRule("common")] }]);
      const audit = makeAuditPort([
        makeTrace("t1", ["common"]),
        makeTrace("t2", ["common"]),
        makeTrace("t3", ["common"]),
        makeTrace("t4", ["common"]),
        makeTrace("t5", ["common"]),
        makeTrace("t6", ["common"]),
        makeTrace("t7", ["common"]),
        makeTrace("t8", ["common"]),
        makeTrace("t9", ["common"]),
        makeTrace("t10", ["common"]),
        makeTrace("t11", ["common"]),
        makeTrace("t12", ["common"]),
        makeTrace("t13", ["common"]),
        makeTrace("t14", ["common"]),
        makeTrace("t15", ["common"]),
        makeTrace("t16", ["common"]),
        makeTrace("t17", ["common"]),
        makeTrace("t18", ["common"]),
        makeTrace("t19", ["common"]),
        makeTrace("t20", ["rare"]), // 1/20 = 5% -> exactly at threshold
      ]);
      const r = new PolicyRecommender(store, audit, { underperformingThreshold: 0.06 });
      const recs = r.analyzeAll();
      const under = recs.filter((x) => x.type === "underperforming_rule");
      expect(under).toHaveLength(1);
      expect(under[0].ruleId).toBe("rare");
    });

    it("should not flag rules with no matches (those are dead rules)", () => {
      const store = makePackStore([{ id: "p", rules: [makeRule("never")] }]);
      const audit = makeAuditPort([
        makeTrace("t1", []),
        makeTrace("t2", []),
      ]);
      const r = new PolicyRecommender(store, audit);
      const recs = r.analyzeAll();
      expect(recs.filter((x) => x.type === "underperforming_rule")).toHaveLength(0);
    });
  });

  describe("threshold_tuning detection", () => {
    it("should suggest tuning when lt threshold is near observed values", () => {
      const store = makePackStore([{
        id: "p",
        rules: [makeRule("r1", { when: { retryRate: { lt: 0.1 } } })],
      }]);
      const traces = Array.from({ length: 10 }, (_, i) =>
        makeTrace(`t${i}`, ["r1"], { retryRate: 0.09 + i * 0.001 }),
      );
      const audit = makeAuditPort(traces);
      const r = new PolicyRecommender(store, audit);
      const recs = r.analyzeAll();
      const tuning = recs.filter((x) => x.type === "threshold_tuning");
      expect(tuning.length).toBeGreaterThanOrEqual(1);
      expect(tuning[0].ruleId).toBe("r1");
    });

    it("should not suggest tuning when values are far from threshold", () => {
      const store = makePackStore([{
        id: "p",
        rules: [makeRule("r1", { when: { retryRate: { lt: 0.5 } } })],
      }]);
      const traces = Array.from({ length: 10 }, (_, i) =>
        makeTrace(`t${i}`, ["r1"], { retryRate: 0.01 + i * 0.001 }),
      );
      const audit = makeAuditPort(traces);
      const r = new PolicyRecommender(store, audit);
      const recs = r.analyzeAll();
      expect(recs.filter((x) => x.type === "threshold_tuning")).toHaveLength(0);
    });

    it("should skip tuning with fewer than 3 samples", () => {
      const store = makePackStore([{
        id: "p",
        rules: [makeRule("r1", { when: { retryRate: { lt: 0.1 } } })],
      }]);
      const traces = Array.from({ length: 2 }, (_, i) =>
        makeTrace(`t${i}`, ["r1"], { retryRate: 0.09 }),
      );
      const audit = makeAuditPort(traces);
      const r = new PolicyRecommender(store, audit);
      expect(r.analyzeAll().filter((x) => x.type === "threshold_tuning")).toHaveLength(0);
    });
  });

  describe("rule_conflict detection", () => {
    it("should flag overlapping conditions", () => {
      const store = makePackStore([{
        id: "p",
        rules: [
          makeRule("r1", { when: { retryRate: { gt: 0.1 } } }),
          makeRule("r2", { when: { retryRate: { lt: 0.5 } } }),
        ],
      }]);
      const audit = makeAuditPort([]);
      const r = new PolicyRecommender(store, audit);
      const recs = r.analyzeAll();
      const conflicts = recs.filter((x) => x.type === "rule_conflict");
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].ruleId).toBe("r1");
      expect(conflicts[0].relatedRuleIds).toEqual(["r2"]);
    });

    it("should not flag non-overlapping conditions", () => {
      const store = makePackStore([{
        id: "p",
        rules: [
          makeRule("r1", { when: { retryRate: { gt: 0.1 } } }),
          makeRule("r2", { when: { successRate: { lt: 0.9 } } }),
        ],
      }]);
      const audit = makeAuditPort([]);
      const r = new PolicyRecommender(store, audit);
      expect(r.analyzeAll().filter((x) => x.type === "rule_conflict")).toHaveLength(0);
    });

    it("should not flag when only one rule exists", () => {
      const store = makePackStore([{ id: "p", rules: [makeRule("r1")] }]);
      const audit = makeAuditPort([]);
      const r = new PolicyRecommender(store, audit);
      expect(r.analyzeAll().filter((x) => x.type === "rule_conflict")).toHaveLength(0);
    });
  });

  describe("analyzePack", () => {
    it("should analyze a single pack by ID", () => {
      const store = makePackStore([{ id: "p1", rules: [makeRule("r1")] }, { id: "p2", rules: [makeRule("dead")] }]);
      const audit = makeAuditPort([makeTrace("t1", ["r1"])]);
      const r = new PolicyRecommender(store, audit);
      const recs = r.analyzePack("p2");
      expect(recs).toHaveLength(1);
      expect(recs[0].ruleId).toBe("dead");
    });

    it("should return empty for unknown pack", () => {
      const store = makeEmptyPackStore();
      const audit = makeAuditPort([]);
      const r = new PolicyRecommender(store, audit);
      expect(r.analyzePack("nonexistent")).toHaveLength(0);
    });
  });

  describe("options", () => {
    it("should respect maxTraces", () => {
      const store = makePackStore([{ id: "p", rules: [makeRule("r1")] }]);
      const audit = makeAuditPort([
        makeTrace("t1", ["r1"], { retryRate: 0.05 }),
        makeTrace("t2", ["r1"], { retryRate: 0.05 }),
      ]);
      const r = new PolicyRecommender(store, audit, { maxTraces: 1 });
      const recs = r.analyzeAll();
      expect(recs.filter((x) => x.type === "dead_rule")).toHaveLength(0);
      expect(recs.filter((x) => x.type === "threshold_tuning")).toHaveLength(0); // only 1 trace, < 3 needed
    });

    it("should use default options when none provided", () => {
      const store = makeEmptyPackStore();
      const audit = makeAuditPort([]);
      const r = new PolicyRecommender(store, audit);
      expect(() => r.analyzeAll()).not.toThrow();
    });
  });
});
