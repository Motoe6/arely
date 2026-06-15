import { describe, it, expect } from "vitest";
import { RiskEstimator } from "@arelyos/engine/llm/risk-estimator.js";
import type { ExecutionPrediction } from "@arelyos/engine/llm/prediction-types.js";

describe("RiskEstimator", () => {
  const estimator = new RiskEstimator();

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

  it("should classify P >= 0.85 as low risk", () => {
    expect(estimator.estimate(makePrediction({ successProbability: 0.85 }))).toBe("low");
    expect(estimator.estimate(makePrediction({ successProbability: 0.95 }))).toBe("low");
  });

  it("should classify 0.60 <= P < 0.85 as medium risk", () => {
    expect(estimator.estimate(makePrediction({ successProbability: 0.60 }))).toBe("medium");
    expect(estimator.estimate(makePrediction({ successProbability: 0.75 }))).toBe("medium");
    expect(estimator.estimate(makePrediction({ successProbability: 0.84 }))).toBe("medium");
  });

  it("should classify P < 0.60 as high risk", () => {
    expect(estimator.estimate(makePrediction({ successProbability: 0.59 }))).toBe("high");
    expect(estimator.estimate(makePrediction({ successProbability: 0.30 }))).toBe("high");
    expect(estimator.estimate(makePrediction({ successProbability: 0 }))).toBe("high");
  });

  it("should recommend execute immediately for low risk", () => {
    expect(estimator.getRecommendation("low")).toBe("execute immediately");
  });

  it("should recommend execute with monitoring for medium risk", () => {
    expect(estimator.getRecommendation("medium")).toBe("execute with monitoring");
  });

  it("should recommend replan for high risk", () => {
    expect(estimator.getRecommendation("high")).toBe("replan or ask for clarification");
  });
});
