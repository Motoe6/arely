import { describe, it, expect } from "vitest";
import { PlanScorer } from "@arelyos/engine/llm/plan-scorer.js";
import type { ExecutionPrediction } from "@arelyos/engine/llm/prediction-types.js";

describe("PlanScorer", () => {
  const scorer = new PlanScorer();

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

  it("should score 100 for perfect prediction", () => {
    const score = scorer.score(makePrediction({
      successProbability: 1,
      expectedCostUsd: 0,
      expectedLatencyMs: 0,
    }));
    expect(score).toBe(100);
  });

  it("should score higher for better predictions", () => {
    const good = scorer.score(makePrediction({
      successProbability: 0.9,
      expectedCostUsd: 0.0005,
      expectedLatencyMs: 300,
    }));
    const bad = scorer.score(makePrediction({
      successProbability: 0.3,
      expectedCostUsd: 0.05,
      expectedLatencyMs: 6000,
    }));

    expect(good).toBeGreaterThan(bad);
  });

  it("should prioritize success probability over cost", () => {
    const highSuccess = scorer.score(makePrediction({
      successProbability: 0.9,
      expectedCostUsd: 0.01,
      expectedLatencyMs: 1000,
    }));
    const lowSuccess = scorer.score(makePrediction({
      successProbability: 0.5,
      expectedCostUsd: 0,
      expectedLatencyMs: 0,
    }));

    expect(highSuccess).toBeGreaterThan(lowSuccess);
  });

  it("should penalize high cost", () => {
    const cheap = scorer.score(makePrediction({
      successProbability: 0.7,
      expectedCostUsd: 0.0005,
      expectedLatencyMs: 1000,
    }));
    const expensive = scorer.score(makePrediction({
      successProbability: 0.7,
      expectedCostUsd: 0.1,
      expectedLatencyMs: 1000,
    }));

    expect(cheap).toBeGreaterThan(expensive);
  });

  it("should penalize high latency", () => {
    const fast = scorer.score(makePrediction({
      successProbability: 0.7,
      expectedCostUsd: 0.001,
      expectedLatencyMs: 200,
    }));
    const slow = scorer.score(makePrediction({
      successProbability: 0.7,
      expectedCostUsd: 0.001,
      expectedLatencyMs: 15000,
    }));

    expect(fast).toBeGreaterThan(slow);
  });

  it("should clamp to 0-100 range", () => {
    const score = scorer.score(makePrediction({
      successProbability: 0,
      expectedCostUsd: 100,
      expectedLatencyMs: 99999,
    }));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
