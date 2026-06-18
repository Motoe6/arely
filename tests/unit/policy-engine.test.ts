import { describe, it, expect, vi } from "vitest";
import { DefaultPolicyEngine } from "../../packages/engine/src/runtime/policy-engine.js";
import { DefaultGoalManager } from "../../packages/engine/src/runtime/goal-manager.js";

describe("DefaultPolicyEngine", () => {
  it("allows goals within limits", () => {
    const engine = new DefaultPolicyEngine();
    const goal = new DefaultGoalManager().createGoal({ description: "test" });
    expect(engine.check(goal).allowed).toBe(true);
  });

  it("rejects goals that exceed maxRetries", () => {
    const engine = new DefaultPolicyEngine({ maxGoalRetries: 2 });
    const mgr = new DefaultGoalManager();
    const goal = mgr.createGoal({ description: "test", maxRetries: 1 });
    // Override retries to exceed policy
    mgr.updateGoal(goal.id, { retries: 2, status: "pending" });
    const updated = mgr.getGoal(goal.id)!;
    expect(engine.check(updated).allowed).toBe(false);
  });

  it("getAllPolicies returns all policies with values", () => {
    const engine = new DefaultPolicyEngine();
    const policies = engine.getAllPolicies();
    expect(policies.length).toBeGreaterThanOrEqual(7);
    expect(policies.find((p) => p.name === "maxGoalRetries")).toBeTruthy();
  });

  it("updatePolicy changes policy value", () => {
    const engine = new DefaultPolicyEngine();
    engine.updatePolicy("maxActiveGoals", 5);
    expect(engine.getPolicyValue?.("maxActiveGoals")).toBe(5);
  });

  it("initial values override defaults", () => {
    const engine = new DefaultPolicyEngine({ maxActiveGoals: 20 });
    expect(engine.getPolicyValue?.("maxActiveGoals")).toBe(20);
  });
});
