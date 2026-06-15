import { describe, it, expect, beforeEach } from "vitest";
import { PredictionCalibrator } from "@arely/engine/llm/prediction-calibrator.js";
import type { ExecutionPrediction } from "@arely/engine/llm/prediction-types.js";

describe("PredictionCalibrator", () => {
  let calibrator: PredictionCalibrator;

  function makePrediction(sp: number): ExecutionPrediction {
    return {
      successProbability: sp,
      expectedCostUsd: 0,
      expectedLatencyMs: 0,
      confidence: 0.5,
      risk: sp >= 0.85 ? "low" : sp >= 0.60 ? "medium" : "high",
      rationale: [],
    };
  }

  function ctx(overrides?: Partial<{ taskType: string; strategy: string; provider: string; model: string }>) {
    return {
      taskType: "coding",
      strategy: "research_first",
      provider: "openai",
      model: "gpt-4o",
      ...overrides,
    };
  }

  beforeEach(() => {
    calibrator = new PredictionCalibrator();
  });

  describe("recordForecast", () => {
    it("should return error = actual - predicted for success", () => {
      const result = calibrator.recordForecast(makePrediction(0.80), true, ctx());
      expect(result.predicted).toBe(0.80);
      expect(result.actual).toBe(1);
      expect(result.error).toBeCloseTo(0.20, 10);
    });

    it("should return error = actual - predicted for failure", () => {
      const result = calibrator.recordForecast(makePrediction(0.80), false, ctx());
      expect(result.actual).toBe(0);
      expect(result.error).toBe(-0.80);
    });

    it("should compute absolute error", () => {
      const result = calibrator.recordForecast(makePrediction(0.80), false, ctx());
      expect(result.absoluteError).toBe(0.80);
    });
  });

  describe("getCalibrationStats", () => {
    it("should return empty array when no records", () => {
      expect(calibrator.getCalibrationStats("task")).toHaveLength(0);
    });

    it("should compute prediction bias by task", () => {
      calibrator.recordForecast(makePrediction(0.90), true, ctx({ taskType: "coding" }));
      calibrator.recordForecast(makePrediction(0.80), true, ctx({ taskType: "coding" }));
      calibrator.recordForecast(makePrediction(0.85), false, ctx({ taskType: "coding" }));

      const stats = calibrator.getCalibrationStats("task");
      expect(stats).toHaveLength(1);
      expect(stats[0].key).toBe("coding");
      expect(stats[0].observations).toBe(3);
      expect(stats[0].predictionBias).toBeCloseTo((0.10 + 0.20 - 0.85) / 3, 5);
    });

    it("should compute brier score", () => {
      calibrator.recordForecast(makePrediction(0.90), true, ctx());
      calibrator.recordForecast(makePrediction(0.80), false, ctx());

      const stats = calibrator.getCalibrationStats("task");
      const expectedBrier = ((0.90 - 1) ** 2 + (0.80 - 0) ** 2) / 2;
      expect(stats[0].brierScore).toBeCloseTo(expectedBrier, 5);
    });

    it("should aggregate by strategy", () => {
      calibrator.recordForecast(makePrediction(0.90), true, ctx({ strategy: "oneshot" }));
      calibrator.recordForecast(makePrediction(0.70), false, ctx({ strategy: "research_first" }));

      const stats = calibrator.getCalibrationStats("strategy");
      expect(stats).toHaveLength(2);

      const oneshot = stats.find((s) => s.key === "oneshot");
      expect(oneshot?.observations).toBe(1);
      expect(oneshot?.predictionBias).toBeCloseTo(0.10, 5);
    });

    it("should aggregate by model", () => {
      calibrator.recordForecast(makePrediction(0.90), true, ctx({ provider: "openai", model: "gpt-4o" }));
      calibrator.recordForecast(makePrediction(0.70), false, ctx({ provider: "ollama", model: "deepseek-r1" }));

      const stats = calibrator.getCalibrationStats("model");
      expect(stats).toHaveLength(2);
      expect(stats.some((s) => s.key === "openai/gpt-4o")).toBe(true);
      expect(stats.some((s) => s.key === "ollama/deepseek-r1")).toBe(true);
    });

    it("should sort by observations descending", () => {
      calibrator.recordForecast(makePrediction(0.90), true, ctx({ taskType: "coding" }));
      calibrator.recordForecast(makePrediction(0.90), true, ctx({ taskType: "coding" }));
      calibrator.recordForecast(makePrediction(0.90), true, ctx({ taskType: "debugging" }));

      const stats = calibrator.getCalibrationStats("task");
      expect(stats[0].key).toBe("coding");
      expect(stats[0].observations).toBe(2);
    });
  });

  describe("getTaskCalibration", () => {
    it("should return stats for specific task", () => {
      calibrator.recordForecast(makePrediction(0.80), true, ctx({ taskType: "debugging" }));
      const stats = calibrator.getTaskCalibration("debugging");
      expect(stats).not.toBeNull();
      expect(stats!.key).toBe("debugging");
    });

    it("should return null for unknown task", () => {
      expect(calibrator.getTaskCalibration("nonexistent")).toBeNull();
    });
  });

  describe("getStrategyCalibration", () => {
    it("should return stats for specific strategy", () => {
      calibrator.recordForecast(makePrediction(0.80), true, ctx({ strategy: "oneshot" }));
      const stats = calibrator.getStrategyCalibration("oneshot");
      expect(stats).not.toBeNull();
      expect(stats!.key).toBe("oneshot");
    });
  });

  describe("getModelCalibration", () => {
    it("should return stats for specific model", () => {
      calibrator.recordForecast(makePrediction(0.80), true, ctx({ provider: "openai", model: "gpt-4o" }));
      const stats = calibrator.getModelCalibration("openai", "gpt-4o");
      expect(stats).not.toBeNull();
      expect(stats!.key).toBe("openai/gpt-4o");
    });
  });

  describe("generateCalibrationSummary", () => {
    it("should return empty when no records", () => {
      const summary = calibrator.generateCalibrationSummary();
      expect(summary).toContain("[Forecast Calibration]");
    });

    it("should include all dimensions with data", () => {
      calibrator.recordForecast(makePrediction(0.90), true, ctx({ taskType: "coding", strategy: "oneshot" }));
      const summary = calibrator.generateCalibrationSummary();
      expect(summary).toContain("coding");
      expect(summary).toContain("oneshot");
      expect(summary).toContain("bias=");
      expect(summary).toContain("brier=");
    });
  });
});
