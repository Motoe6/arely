import { describe, it, expect } from "vitest";
import { createStrategyCollector } from "@arely/benchmarks/collectors/strategy.js";
import type { DecisionRecord } from "@arely/persistence";

function makeDecision(overrides: Partial<DecisionRecord> & { strategy: string; outcome: "success" | "failure" }): DecisionRecord {
  return {
    id: "d1",
    sessionId: "s1",
    decisionType: "strategy_selection",
    decision: "use " + overrides.strategy,
    rationale: "test",
    confidence: 100,
    memoriesUsed: [],
    memorySnapshot: [],
    epochId: null,
    proposalId: null,
    templateId: null,
    outcome: overrides.outcome,
    outcomeDetail: null,
    metadata: { strategy: overrides.strategy },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("StrategyCollector", () => {
  it("returns empty suite when no decisions provided", () => {
    const collector = createStrategyCollector([]);
    const result = collector.collect();
    expect(result.name).toBe("strategy");
    const tracked = result.metrics.find((m) => m.name === "strategies_tracked");
    expect(tracked!.value).toBe(0);
  });

  it("computes success rate for a single strategy", () => {
    const decisions = [
      makeDecision({ strategy: "chain_of_thought", outcome: "success" }),
      makeDecision({ strategy: "chain_of_thought", outcome: "success" }),
      makeDecision({ strategy: "chain_of_thought", outcome: "failure" }),
    ];

    const collector = createStrategyCollector(decisions);
    const result = collector.collect();

    const rate = result.metrics.find((m) => m.name === "strategy_success_rate__chain_of_thought");
    expect(rate).toBeDefined();
    expect(rate!.value).toBeCloseTo(0.667, 1);
    expect(rate!.passed).toBe(true);
  });

  it("reports overall success rate across strategies", () => {
    const decisions = [
      makeDecision({ strategy: "chain_of_thought", outcome: "success" }),
      makeDecision({ strategy: "direct", outcome: "failure" }),
      makeDecision({ strategy: "chain_of_thought", outcome: "success" }),
    ];

    const collector = createStrategyCollector(decisions);
    const result = collector.collect();

    const overall = result.metrics.find((m) => m.name === "overall_success_rate");
    expect(overall).toBeDefined();
    expect(overall!.value).toBeCloseTo(0.667, 1);

    const attempts = result.metrics.find((m) => m.name === "total_attempts");
    expect(attempts!.value).toBe(3);
  });

  it("handles low success rate that fails threshold", () => {
    const decisions = [
      makeDecision({ strategy: "direct", outcome: "failure" }),
      makeDecision({ strategy: "direct", outcome: "failure" }),
      makeDecision({ strategy: "direct", outcome: "success" }),
    ];

    const collector = createStrategyCollector(decisions);
    const result = collector.collect();

    const rate = result.metrics.find((m) => m.name === "strategy_success_rate__direct");
    expect(rate!.value).toBeCloseTo(0.333, 1);
    expect(rate!.passed).toBe(false);
  });

  it("ignores decisions without a strategy in metadata", () => {
    const decisions: DecisionRecord[] = [
      {
        id: "d1", sessionId: "s1", decisionType: "other", decision: "x",
        rationale: "r", confidence: 100, memoriesUsed: [], memorySnapshot: [],
        epochId: null, proposalId: null, templateId: null,
        outcome: "success", outcomeDetail: null,
        metadata: {},
        createdAt: new Date().toISOString(),
      },
    ];

    const collector = createStrategyCollector(decisions);
    const result = collector.collect();
    const tracked = result.metrics.find((m) => m.name === "strategies_tracked");
    expect(tracked!.value).toBe(0);
  });
});
