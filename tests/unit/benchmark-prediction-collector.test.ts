import { describe, it, expect } from "vitest";
import { PredictionCalibrator } from "@arelyos/engine/llm/prediction-calibrator.js";
import { createPredictionCollector } from "@arelyos/benchmarks/collectors/prediction.js";

describe("PredictionCollector", () => {
  it("returns empty suite when calibrator has no records", () => {
    const calibrator = new PredictionCalibrator();
    const collector = createPredictionCollector(calibrator);
    const result = collector.collect();
    expect(result.name).toBe("prediction");
    expect(result.metrics).toHaveLength(0);
  });

  it("reports metrics per dimension after records are added", () => {
    const calibrator = new PredictionCalibrator();

    calibrator.recordForecast(
      { successProbability: 0.8, expectedCostUsd: 0.1, expectedLatencyMs: 100, confidence: 0.9, risk: "low", rationale: [] },
      true,
      { taskType: "coding", strategy: "chain_of_thought", provider: "openai", model: "gpt-4" },
    );
    calibrator.recordForecast(
      { successProbability: 0.4, expectedCostUsd: 0.1, expectedLatencyMs: 100, confidence: 0.9, risk: "high", rationale: [] },
      false,
      { taskType: "research", strategy: "direct", provider: "anthropic", model: "claude-3" },
    );

    const collector = createPredictionCollector(calibrator);
    const result = collector.collect();

    expect(result.metrics.length).toBeGreaterThan(0);

    const taskMetrics = result.metrics.filter((m) => m.name.startsWith("task_"));
    expect(taskMetrics.length).toBeGreaterThan(0);

    const codingBias = result.metrics.find((m) => m.name === "task_bias__coding");
    expect(codingBias).toBeDefined();
    expect(codingBias!.value).toBeCloseTo(0.2, 1); // actual(1) - predicted(0.8) = 0.2
  });

  it("includes thresholds and pass/fail on each metric", () => {
    const calibrator = new PredictionCalibrator();
    calibrator.recordForecast(
      { successProbability: 0.5, expectedCostUsd: 0.1, expectedLatencyMs: 100, confidence: 0.9, risk: "medium", rationale: [] },
      true,
      { taskType: "test", strategy: "direct", provider: "openai", model: "gpt-4" },
    );

    const collector = createPredictionCollector(calibrator);
    const result = collector.collect();

    for (const m of result.metrics) {
      if (m.name.endsWith("__test")) {
        expect(m.threshold).toBeDefined();
        expect(m.passed).toBeTypeOf("boolean");
      }
    }
  });

  it("aggregates averages across observations per dimension", () => {
    const calibrator = new PredictionCalibrator();
    for (let i = 0; i < 5; i++) {
      calibrator.recordForecast(
        { successProbability: 0.7, expectedCostUsd: 0.1, expectedLatencyMs: 100, confidence: 0.9, risk: "low", rationale: [] },
        true,
        { taskType: "coding", strategy: "chain_of_thought", provider: "openai", model: "gpt-4" },
      );
    }

    const collector = createPredictionCollector(calibrator);
    const result = collector.collect();

    const avgBias = result.metrics.find((m) => m.name === "task_avg_bias");
    expect(avgBias).toBeDefined();
    expect(avgBias!.value).toBeCloseTo(0.3, 1); // 5 × (1 - 0.7) / 5 = 0.3
    expect(avgBias!.passed).toBe(false);
  });

  it("reports metrics for all three dimensions: task, strategy, model", () => {
    const calibrator = new PredictionCalibrator();
    calibrator.recordForecast(
      { successProbability: 0.8, expectedCostUsd: 0.1, expectedLatencyMs: 100, confidence: 0.9, risk: "low", rationale: [] },
      true,
      { taskType: "coding", strategy: "direct", provider: "openai", model: "gpt-4" },
    );

    const collector = createPredictionCollector(calibrator);
    const result = collector.collect();

    expect(result.metrics.some((m) => m.name.startsWith("task_"))).toBe(true);
    expect(result.metrics.some((m) => m.name.startsWith("strategy_"))).toBe(true);
    expect(result.metrics.some((m) => m.name.startsWith("model_"))).toBe(true);
  });
});
