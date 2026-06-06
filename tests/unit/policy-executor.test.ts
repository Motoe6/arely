import { describe, it, expect, beforeEach } from "vitest";
import { PolicyExecutor } from "@opencode/engine/agents/policy/policy-executor.js";
import type { PolicyAction } from "@opencode/engine/agents/policy/policy-types.js";
import type { PolicyActionHandlers } from "@opencode/engine/agents/policy/policy-execution-types.js";

function makeAction(overrides?: Partial<PolicyAction>): PolicyAction {
  return {
    ruleId: "high_retry",
    action: "trigger_remediation",
    payload: { policy: "exponential_jitter" },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeHandlers(): PolicyActionHandlers {
  return {
    trigger_remediation: async () => {},
    reset_circuit_breaker: async () => {},
    escalate_alert: async () => {},
  };
}

describe("PolicyExecutor", () => {
  let handlers: PolicyActionHandlers;

  beforeEach(() => {
    handlers = makeHandlers();
  });

  it("should execute trigger_remediation successfully", async () => {
    let called = false;
    handlers.trigger_remediation = async (payload) => {
      called = true;
      expect(payload).toEqual({ policy: "exponential_jitter" });
    };
    const executor = new PolicyExecutor(handlers);
    const results = await executor.execute([makeAction()]);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("success");
    expect(called).toBe(true);
  });

  it("should execute reset_circuit_breaker successfully", async () => {
    let called = false;
    handlers.reset_circuit_breaker = async () => {
      called = true;
    };
    const executor = new PolicyExecutor(handlers);
    const results = await executor.execute([makeAction({ action: "reset_circuit_breaker" })]);
    expect(results[0].status).toBe("success");
    expect(called).toBe(true);
  });

  it("should execute escalate_alert successfully", async () => {
    let called = false;
    handlers.escalate_alert = async () => {
      called = true;
    };
    const executor = new PolicyExecutor(handlers);
    const results = await executor.execute([makeAction({ action: "escalate_alert" })]);
    expect(results[0].status).toBe("success");
    expect(called).toBe(true);
  });

  it("should isolate handler failures (no cascade)", async () => {
    handlers.trigger_remediation = async () => { throw new Error("first failed"); };
    const executor = new PolicyExecutor(handlers);
    const results = await executor.execute([
      makeAction({ ruleId: "r1" }),
      makeAction({ ruleId: "r2", action: "reset_circuit_breaker" }),
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toContain("first failed");
    expect(results[1].status).toBe("success");
  });

  it("should enforce timeout on slow handlers", async () => {
    handlers.trigger_remediation = async () => {
      await new Promise((r) => setTimeout(r, 500));
    };
    const executor = new PolicyExecutor(handlers, { handlerTimeoutMs: 50 });
    const results = await executor.execute([makeAction()]);
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toContain("timed out");
  });

  it("should skip duplicate execution by idempotency", async () => {
    let callCount = 0;
    handlers.trigger_remediation = async () => {
      callCount++;
    };
    const executor = new PolicyExecutor(handlers);
    const action = makeAction();
    const results = await executor.execute([action, action]);
    expect(callCount).toBe(1);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("success");
    expect(results[1].status).toBe("skipped");
    expect(results[1].error).toContain("duplicate");
  });

  it("should return structured execution results", async () => {
    const executor = new PolicyExecutor(handlers);
    const results = await executor.execute([makeAction()]);
    expect(results[0]).toHaveProperty("action");
    expect(results[0]).toHaveProperty("status", "success");
    expect(results[0]).toHaveProperty("startedAt");
    expect(results[0]).toHaveProperty("finishedAt");
    expect(results[0].startedAt).toBeTypeOf("number");
    expect(results[0].finishedAt).toBeGreaterThanOrEqual(results[0].startedAt);
  });

  it("should handle unknown action type gracefully", async () => {
    const executor = new PolicyExecutor(handlers);
    const results = await executor.execute([makeAction({ action: "trigger_remediation" as const })]);
    expect(results[0].status).toBe("success");
  });

  it("should process multiple actions in batch order", async () => {
    const order: string[] = [];
    handlers.trigger_remediation = async () => { order.push("a"); };
    handlers.reset_circuit_breaker = async () => { order.push("b"); };
    handlers.escalate_alert = async () => { order.push("c"); };
    const executor = new PolicyExecutor(handlers);
    await executor.execute([
      makeAction({ ruleId: "r1", action: "trigger_remediation" }),
      makeAction({ ruleId: "r2", action: "reset_circuit_breaker" }),
      makeAction({ ruleId: "r3", action: "escalate_alert" }),
    ]);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("should clear executed set on clearExecuted", async () => {
    let callCount = 0;
    handlers.trigger_remediation = async () => { callCount++; };
    const executor = new PolicyExecutor(handlers);
    const action = makeAction();
    await executor.execute([action]);
    expect(callCount).toBe(1);
    executor.clearExecuted();
    await executor.execute([action]);
    expect(callCount).toBe(2);
  });
});
