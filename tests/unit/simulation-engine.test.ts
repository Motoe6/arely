import { describe, it, expect } from "vitest";
import { SimulationEngine, computePolicyHash, type AuditStorePort } from "@arely/engine/agents/simulation/simulation-engine.js";
import type { PolicyAuditEvent } from "@arely/engine/persistence/policy-audit-store.js";
import type { PolicyRule } from "@arely/engine/agents/policy/policy-types.js";

function makeRule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: "r1",
    when: {},
    then: { type: "trigger_remediation", payload: {} },
    cooldownMs: 60000,
    maxExecutionsPerHour: 10,
    ...overrides,
  };
}

function makeTraceEvent(
  eventType: string,
  payload: Record<string, unknown>,
  overrides: Partial<PolicyAuditEvent> = {},
): PolicyAuditEvent {
  return {
    id: `evt-${eventType}`,
    traceId: "trace-1",
    eventType,
    payload,
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeEmptyStore(): AuditStorePort {
  return { getTrace: () => [] };
}

function makeStore(events: PolicyAuditEvent[]): AuditStorePort {
  return { getTrace: () => events };
}

describe("computePolicyHash", () => {
  it("should return a deterministic hash for identical rules", () => {
    const rulesA = [makeRule({ id: "r1" }), makeRule({ id: "r2", when: { retryRate: { gt: 0.1 } } })];
    const rulesB = [makeRule({ id: "r2", when: { retryRate: { gt: 0.1 } } }), makeRule({ id: "r1" })];
    expect(computePolicyHash(rulesA)).toBe(computePolicyHash(rulesB));
  });

  it("should return different hashes for different rules", () => {
    const hashA = computePolicyHash([makeRule({ id: "r1" })]);
    const hashB = computePolicyHash([makeRule({ id: "r1", when: { retryRate: { gt: 0.5 } } })]);
    expect(hashA).not.toBe(hashB);
  });

  it("should return a 16-char hex string", () => {
    const hash = computePolicyHash([makeRule()]);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("SimulationEngine", () => {
  describe("simulateTrace", () => {
    it("should return trace_not_found error when trace has no events", () => {
      const engine = new SimulationEngine(makeEmptyStore());
      const result = engine.simulateTrace("missing", [makeRule()]);
      expect(result.error).toBe("trace_not_found");
      expect(result.originalActions).toEqual([]);
      expect(result.simulatedActions).toEqual([]);
      expect(result.matchRate).toBe(1.0);
    });

    it("should return missing_cycle_started error when no cycle_started event exists", () => {
      const store = makeStore([makeTraceEvent("remediation_executed", { ruleId: "r1" })]);
      const engine = new SimulationEngine(store);
      const result = engine.simulateTrace("trace-1", [makeRule()]);
      expect(result.error).toBe("missing_cycle_started");
    });

    it("should return exact match when historical actions equal simulated", () => {
      const rule = makeRule({ id: "r1", then: { type: "trigger_remediation", payload: { channel: "slack" } } });
      const events = [
        makeTraceEvent("cycle_started", {
          metrics: { successRate: 0.5 },
          circuitBreakerStates: {},
          actions: [{ ruleId: "r1", action: "trigger_remediation", payload: { channel: "slack" } }],
        }),
      ];
      const engine = new SimulationEngine(makeStore(events));
      const result = engine.simulateTrace("trace-1", [rule]);
      expect(result.error).toBeUndefined();
      expect(result.matchRate).toBe(1.0);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
    });

    it("should detect added actions when simulation introduces new rules", () => {
      const oldRule = makeRule({ id: "r1" });
      const oldEvents = [
        makeTraceEvent("cycle_started", {
          metrics: { successRate: 0.3 },
          circuitBreakerStates: {},
          actions: [{ ruleId: "r1", action: "trigger_remediation" }],
        }),
      ];
      const newRules = [
        makeRule({ id: "r1" }),
        makeRule({ id: "r2", when: { successRate: { lt: 0.5 } }, then: { type: "escalate_alert", payload: {} } }),
      ];
      const engine = new SimulationEngine(makeStore(oldEvents));
      const result = engine.simulateTrace("trace-1", newRules);
      expect(result.error).toBeUndefined();
      expect(result.added.length).toBe(1);
      expect(result.added[0].ruleId).toBe("r2");
      expect(result.removed.length).toBe(0);
    });

    it("should detect removed actions when simulation no longer matches", () => {
      const oldEvents = [
        makeTraceEvent("cycle_started", {
          metrics: { successRate: 0.9 },
          circuitBreakerStates: {},
          actions: [{ ruleId: "r1", action: "trigger_remediation" }],
        }),
      ];
      const newRules = [makeRule({ id: "r1", when: { successRate: { lt: 0.5 } } })];
      const engine = new SimulationEngine(makeStore(oldEvents));
      const result = engine.simulateTrace("trace-1", newRules);
      expect(result.added.length).toBe(0);
      expect(result.removed.length).toBe(1);
      expect(result.removed[0].ruleId).toBe("r1");
    });

    it("should return matchRate of 1.0 when both action sets are empty", () => {
      const events = [
        makeTraceEvent("cycle_started", {
          metrics: { successRate: 0.9 },
          circuitBreakerStates: {},
          actions: [],
        }),
      ];
      const engine = new SimulationEngine(makeStore(events));
      const result = engine.simulateTrace("trace-1", [makeRule({ when: { successRate: { lt: 0.5 } } })]);
      expect(result.matchRate).toBe(1.0);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
    });

    it("should preserve policyHash from the historical payload", () => {
      const events = [
        makeTraceEvent("cycle_started", {
          policyHash: "abc123def456",
          metrics: {},
          circuitBreakerStates: {},
          actions: [],
        }),
      ];
      const engine = new SimulationEngine(makeStore(events));
      const result = engine.simulateTrace("trace-1", [makeRule()]);
      expect(result.policyHash).toBe("abc123def456");
    });

    it("should populate simulatedPolicyHash", () => {
      const events = [makeTraceEvent("cycle_started", { metrics: {}, circuitBreakerStates: {}, actions: [] })];
      const rules = [makeRule()];
      const engine = new SimulationEngine(makeStore(events));
      const result = engine.simulateTrace("trace-1", rules);
      expect(result.simulatedPolicyHash).toBe(computePolicyHash(rules));
    });
  });

  describe("simulateBatch", () => {
    it("should process multiple traces and aggregate results", () => {
      const rule = makeRule({ id: "r1" });
      const eventMap: Record<string, PolicyAuditEvent[]> = {
        "trace-a": [
          makeTraceEvent("cycle_started", {
            metrics: { successRate: 0.3 },
            circuitBreakerStates: {},
            actions: [{ ruleId: "r1", action: "trigger_remediation" }],
          }),
        ],
      };
      const store: AuditStorePort = { getTrace: (id: string) => eventMap[id] ?? [] };
      const engine = new SimulationEngine(store);

      const result = engine.simulateBatch(["trace-a", "missing"], [rule]);
      expect(result.tracesRequested).toBe(2);
      expect(result.tracesSucceeded).toBe(1);
      expect(result.tracesFailed).toBe(1);
      expect(result.totalAdded).toBe(0);
      expect(result.totalRemoved).toBe(0);
    });

    it("should compute overallMatchRate across successful traces", () => {
      const store = {
        getTrace: (traceId: string) => {
          if (traceId === "t1") {
            return [
              makeTraceEvent("cycle_started", {
                metrics: { successRate: 0.3 },
                circuitBreakerStates: {},
                actions: [{ ruleId: "r1", action: "trigger_remediation" }],
              }),
            ];
          }
          return [
            makeTraceEvent("cycle_started", {
              metrics: { successRate: 0.9 },
              circuitBreakerStates: {},
              actions: [],
            }),
          ];
        },
      };
      const rules = [makeRule({ id: "r1" })];
      const engine = new SimulationEngine(store);
      const result = engine.simulateBatch(["t1", "t2"], rules);
      expect(result.tracesSucceeded).toBe(2);
      expect(result.overallMatchRate).toBeGreaterThan(0);
      expect(result.overallMatchRate).toBeLessThanOrEqual(1.0);
    });

    it("should return overallMatchRate 1.0 when all traces fail", () => {
      const engine = new SimulationEngine(makeEmptyStore());
      const result = engine.simulateBatch(["t1", "t2"], [makeRule()]);
      expect(result.tracesFailed).toBe(2);
      expect(result.tracesSucceeded).toBe(0);
      expect(result.overallMatchRate).toBe(1.0);
    });

    it("should handle empty traceIds array", () => {
      const engine = new SimulationEngine(makeEmptyStore());
      const result = engine.simulateBatch([], [makeRule()]);
      expect(result.tracesRequested).toBe(0);
      expect(result.tracesSucceeded).toBe(0);
      expect(result.tracesFailed).toBe(0);
      expect(result.results).toEqual([]);
    });
  });
});
