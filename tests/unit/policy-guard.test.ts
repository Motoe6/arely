import { describe, it, expect, beforeEach } from "vitest";
import { PolicyGuard } from "../../src/agents/policy/policy-guard.js";
import type { PolicyRule } from "../../src/agents/policy/policy-types.js";

function makeRule(id: string, overrides?: Partial<PolicyRule>): PolicyRule {
  return {
    id,
    when: { retryRate: { gt: 0.05 } },
    then: { type: "trigger_remediation", payload: {} },
    cooldownMs: 60000,
    maxExecutionsPerHour: 5,
    ...overrides,
  };
}

describe("PolicyGuard", () => {
  let guard: PolicyGuard;

  beforeEach(() => {
    guard = new PolicyGuard({ windowMs: 60000 });
  });

  it("should allow execution when no prior executions exist", () => {
    const result = guard.canExecute(makeRule("r1"), "hash1");
    expect(result.allowed).toBe(true);
  });

  it("should allow execution after cooldown has passed", async () => {
    const rule = makeRule("r1", { cooldownMs: 50 });
    guard.recordExecution(rule, "hash1");
    await new Promise((r) => setTimeout(r, 60));
    const result = guard.canExecute(rule, "hash2");
    expect(result.allowed).toBe(true);
  });

  it("should block execution within cooldown", () => {
    const rule = makeRule("r1", { cooldownMs: 60000 });
    guard.recordExecution(rule, "hash1");
    const result = guard.canExecute(rule, "hash2");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("cooldown");
  });

  it("should block execution beyond max per window", () => {
    const rule = makeRule("r1", { maxExecutionsPerHour: 3, cooldownMs: 0 });
    guard.recordExecution(rule, "hash1");
    guard.recordExecution(rule, "hash2");
    guard.recordExecution(rule, "hash3");
    const result = guard.canExecute(rule, "hash4");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("max");
  });

  it("should allow execution within max per window", () => {
    const rule = makeRule("r1", { maxExecutionsPerHour: 5, cooldownMs: 0 });
    guard.recordExecution(rule, "hash1");
    guard.recordExecution(rule, "hash2");
    const result = guard.canExecute(rule, "hash3");
    expect(result.allowed).toBe(true);
  });

  it("should block duplicate metrics hash (idempotency)", () => {
    const rule = makeRule("r1", { cooldownMs: 0 });
    guard.recordExecution(rule, "same_hash");
    const result = guard.canExecute(rule, "same_hash");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("duplicate");
  });

  it("should allow different metrics hash after cooldown", async () => {
    const rule = makeRule("r1", { cooldownMs: 50 });
    guard.recordExecution(rule, "hash1");
    await new Promise((r) => setTimeout(r, 60));
    const result = guard.canExecute(rule, "hash2");
    expect(result.allowed).toBe(true);
  });
});
