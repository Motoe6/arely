import { describe, it, expect } from "vitest";
import { PolicyEngine } from "@opencode/engine/agents/policy/policy-engine.js";
import type { PolicyRule, PolicyEvaluationInput } from "@opencode/engine/agents/policy/policy-types.js";

function makeInput(overrides?: Partial<PolicyEvaluationInput>): PolicyEvaluationInput {
  return {
    metrics: {
      retryRate: 0.1,
      successRate: 0.95,
      deadLetterRate: 0.02,
      notificationDeliveryRate: 0.98,
    },
    circuitBreakerStates: {},
    ...overrides,
  };
}

describe("PolicyEngine", () => {
  it("should match rule when all conditions are met", () => {
    const rules: PolicyRule[] = [
      {
        id: "high_retry",
        when: { retryRate: { gt: 0.05 } },
        then: { type: "trigger_remediation", payload: { policy: "exponential_jitter" } },
        cooldownMs: 60000,
        maxExecutionsPerHour: 5,
      },
    ];
    const engine = new PolicyEngine(rules);
    const results = engine.evaluate(makeInput({ metrics: { retryRate: 0.1 } }));
    expect(results).toHaveLength(1);
    expect(results[0].matched).toBe(true);
    expect(results[0].action?.action).toBe("trigger_remediation");
  });

  it("should not match rule when condition fails", () => {
    const rules: PolicyRule[] = [
      {
        id: "low_success",
        when: { successRate: { lt: 0.9 } },
        then: { type: "escalate_alert", payload: { severity: "high" } },
        cooldownMs: 60000,
        maxExecutionsPerHour: 5,
      },
    ];
    const engine = new PolicyEngine(rules);
    const results = engine.evaluate(makeInput({ metrics: { successRate: 0.95 } }));
    expect(results[0].matched).toBe(false);
    expect(results[0].action).toBeNull();
  });

  it("should skip condition when metric is undefined", () => {
    const rules: PolicyRule[] = [
      {
        id: "any_dead",
        when: { deadLetterRate: { gt: 0.01 } },
        then: { type: "trigger_remediation", payload: {} },
        cooldownMs: 60000,
        maxExecutionsPerHour: 5,
      },
    ];
    const engine = new PolicyEngine(rules);
    const results = engine.evaluate(makeInput({ metrics: { deadLetterRate: undefined } }));
    expect(results[0].matched).toBe(true);
  });

  it("should match circuitBreakerState against any tool", () => {
    const rules: PolicyRule[] = [
      {
        id: "cb_open",
        when: { circuitBreakerState: "open" },
        then: { type: "reset_circuit_breaker", payload: {} },
        cooldownMs: 120000,
        maxExecutionsPerHour: 3,
      },
    ];
    const engine = new PolicyEngine(rules);
    const results = engine.evaluate(makeInput({
      circuitBreakerStates: { websearch: "open", webfetch: "closed" },
    }));
    expect(results[0].matched).toBe(true);
    expect(results[0].action?.action).toBe("reset_circuit_breaker");
  });

  it("should not match circuitBreakerState when no tool matches", () => {
    const rules: PolicyRule[] = [
      {
        id: "cb_open",
        when: { circuitBreakerState: "open" },
        then: { type: "reset_circuit_breaker", payload: {} },
        cooldownMs: 60000,
        maxExecutionsPerHour: 5,
      },
    ];
    const engine = new PolicyEngine(rules);
    const results = engine.evaluate(makeInput({
      circuitBreakerStates: { websearch: "closed", webfetch: "half_open" },
    }));
    expect(results[0].matched).toBe(false);
  });

  it("should reject successRate with gt at construction", () => {
    expect(() => new PolicyEngine([
      {
        id: "bad",
        // @ts-expect-error — testing runtime validation
        when: { successRate: { gt: 0.8 } },
        then: { type: "escalate_alert", payload: {} },
        cooldownMs: 60000,
        maxExecutionsPerHour: 5,
      },
    ])).toThrow("successRate only supports { lt: number }");
  });

  it("should reject successRate with extra keys", () => {
    expect(() => new PolicyEngine([
      {
        id: "bad",
        when: { successRate: { lt: 0.8, gt: 0.2 } as { lt: number } },
        then: { type: "escalate_alert", payload: {} },
        cooldownMs: 60000,
        maxExecutionsPerHour: 5,
      },
    ])).toThrow("successRate only supports { lt: number }");
  });

  it("should return correct action type per matching rule", () => {
    const rules: PolicyRule[] = [
      {
        id: "r1",
        when: { retryRate: { gt: 0.05 } },
        then: { type: "trigger_remediation", payload: { policy: "circuit_breaker_candidate" } },
        cooldownMs: 60000,
        maxExecutionsPerHour: 5,
      },
      {
        id: "r2",
        when: { deadLetterRate: { gt: 0.1 } },
        then: { type: "escalate_alert", payload: { severity: "critical" } },
        cooldownMs: 60000,
        maxExecutionsPerHour: 5,
      },
    ];
    const engine = new PolicyEngine(rules);
    const results = engine.evaluate(makeInput({ metrics: { retryRate: 0.2, deadLetterRate: 0.15 } }));
    expect(results).toHaveLength(2);
    const r1 = results.find((r) => r.ruleId === "r1")!;
    const r2 = results.find((r) => r.ruleId === "r2")!;
    expect(r1.matched).toBe(true);
    expect(r1.action?.action).toBe("trigger_remediation");
    expect(r2.matched).toBe(true);
    expect(r2.action?.action).toBe("escalate_alert");
  });

  it("should handle notificationDeliveryRate threshold", () => {
    const rules: PolicyRule[] = [
      {
        id: "low_delivery",
        when: { notificationDeliveryRate: { lt: 0.95 } },
        then: { type: "escalate_alert", payload: {} },
        cooldownMs: 60000,
        maxExecutionsPerHour: 5,
      },
    ];
    const engine = new PolicyEngine(rules);
    const low = engine.evaluate(makeInput({ metrics: { notificationDeliveryRate: 0.9 } }));
    expect(low[0].matched).toBe(true);

    const high = engine.evaluate(makeInput({ metrics: { notificationDeliveryRate: 0.99 } }));
    expect(high[0].matched).toBe(false);
  });

  it("should return no actions for empty rules", () => {
    const engine = new PolicyEngine([]);
    const results = engine.evaluate(makeInput());
    expect(results).toHaveLength(0);
  });

  it("should match threshold gt only", () => {
    const rules: PolicyRule[] = [
      {
        id: "rate_gt",
        when: { retryRate: { gt: 0.1 } },
        then: { type: "trigger_remediation", payload: {} },
        cooldownMs: 60000,
        maxExecutionsPerHour: 5,
      },
    ];
    const engine = new PolicyEngine(rules);
    expect(engine.evaluate(makeInput({ metrics: { retryRate: 0.2 } }))[0].matched).toBe(true);
    expect(engine.evaluate(makeInput({ metrics: { retryRate: 0.1 } }))[0].matched).toBe(false);
    expect(engine.evaluate(makeInput({ metrics: { retryRate: 0.05 } }))[0].matched).toBe(false);
  });

  it("should match threshold lt only", () => {
    const rules: PolicyRule[] = [
      {
        id: "rate_lt",
        when: { retryRate: { lt: 0.2 } },
        then: { type: "trigger_remediation", payload: {} },
        cooldownMs: 60000,
        maxExecutionsPerHour: 5,
      },
    ];
    const engine = new PolicyEngine(rules);
    expect(engine.evaluate(makeInput({ metrics: { retryRate: 0.1 } }))[0].matched).toBe(true);
    expect(engine.evaluate(makeInput({ metrics: { retryRate: 0.2 } }))[0].matched).toBe(false);
    expect(engine.evaluate(makeInput({ metrics: { retryRate: 0.3 } }))[0].matched).toBe(false);
  });
});
