import { describe, it, expect } from "vitest";
import { ExecutionGate } from "@arelyos/engine/llm/execution-gate.js";
import type { ExecutionPrediction } from "@arelyos/engine/llm/prediction-types.js";

describe("ExecutionGate", () => {
  function makePrediction(overrides: Partial<ExecutionPrediction>): ExecutionPrediction {
    return {
      successProbability: 0.5,
      expectedCostUsd: 0,
      expectedLatencyMs: 0,
      confidence: 0.5,
      risk: "medium",
      rationale: [],
      ...overrides,
    };
  }

  it("should execute for low risk predictions", () => {
    const gate = new ExecutionGate();
    const result = gate.decide(makePrediction({ successProbability: 0.90 }));
    expect(result.action).toBe("execute");
  });

  it("should monitor for medium risk predictions", () => {
    const gate = new ExecutionGate();
    const result = gate.decide(makePrediction({ successProbability: 0.72 }));
    expect(result.action).toBe("monitor");
  });

  it("should replan for high risk predictions", () => {
    const gate = new ExecutionGate();
    const result = gate.decide(makePrediction({ successProbability: 0.45 }));
    expect(result.action).toBe("replan");
  });

  it("should abort for catastrophic risk", () => {
    const gate = new ExecutionGate();
    const result = gate.decide(makePrediction({ successProbability: 0.20 }));
    expect(result.action).toBe("abort");
  });

  it("should ask user when cost exceeds budget", () => {
    const gate = new ExecutionGate({ budgetUsd: 0.01 });
    const result = gate.decide(makePrediction({
      successProbability: 0.90,
      expectedCostUsd: 0.02,
    }));
    expect(result.action).toBe("ask_user");
  });

  it("should check cost before success probability", () => {
    const gate = new ExecutionGate({ budgetUsd: 0.01 });
    const result = gate.decide(makePrediction({
      successProbability: 0.10,
      expectedCostUsd: 0.02,
    }));
    expect(result.action).toBe("ask_user");
  });

  it("should use custom thresholds", () => {
    const gate = new ExecutionGate({
      lowThreshold: 0.90,
      mediumThreshold: 0.70,
    });
    const medium = gate.decide(makePrediction({ successProbability: 0.85 }));
    expect(medium.action).toBe("monitor");

    const high = gate.decide(makePrediction({ successProbability: 0.60 }));
    expect(high.action).toBe("replan");
  });

  it("should include reason in decision", () => {
    const gate = new ExecutionGate();
    const result = gate.decide(makePrediction({ successProbability: 0.95 }));
    expect(result.reason).toContain("95%");
    expect(result.reason).toContain("threshold");
  });
});
