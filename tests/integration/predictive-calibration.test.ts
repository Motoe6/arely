import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PredictionCalibrator } from "@arely/engine/llm/prediction-calibrator.js";
import { initTestDb, cleanupTestDb } from "../setup.js";
import type { ExecutionPrediction } from "@arely/engine/llm/prediction-types.js";

describe("Predictive Calibration Integration", () => {
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

  beforeEach(() => {
    initTestDb();
    calibrator = new PredictionCalibrator();
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should calibrate across multiple predictions and executions", async () => {
    calibrator.recordForecast(makePrediction(0.90), true, {
      taskType: "coding", strategy: "research_first", provider: "openai", model: "gpt-4o",
    });
    calibrator.recordForecast(makePrediction(0.80), true, {
      taskType: "coding", strategy: "research_first", provider: "openai", model: "gpt-4o",
    });
    calibrator.recordForecast(makePrediction(0.85), false, {
      taskType: "debugging", strategy: "oneshot", provider: "ollama", model: "deepseek-r1",
    });

    const taskStats = calibrator.getCalibrationStats("task");
    expect(taskStats).toHaveLength(2);

    const coding = taskStats.find((s) => s.key === "coding");
    expect(coding).toBeDefined();
    expect(coding!.observations).toBe(2);

    const strategyStats = calibrator.getCalibrationStats("strategy");
    expect(strategyStats).toHaveLength(2);

    const modelStats = calibrator.getCalibrationStats("model");
    expect(modelStats).toHaveLength(2);
  });

  it("should detect optimistic bias", () => {
    calibrator.recordForecast(makePrediction(0.90), false, ctx("coding"));
    calibrator.recordForecast(makePrediction(0.85), false, ctx("coding"));
    calibrator.recordForecast(makePrediction(0.95), false, ctx("coding"));

    const stats = calibrator.getTaskCalibration("coding");
    expect(stats).not.toBeNull();
    expect(stats!.predictionBias).toBeLessThan(0);
  });

  it("should detect pessimistic bias", () => {
    calibrator.recordForecast(makePrediction(0.60), true, ctx("coding"));
    calibrator.recordForecast(makePrediction(0.50), true, ctx("coding"));
    calibrator.recordForecast(makePrediction(0.70), true, ctx("coding"));

    const stats = calibrator.getTaskCalibration("coding");
    expect(stats).not.toBeNull();
    expect(stats!.predictionBias).toBeGreaterThan(0);
  });

  it("should produce calibration summary with correct format", () => {
    calibrator.recordForecast(makePrediction(0.90), true, ctx("research"));
    calibrator.recordForecast(makePrediction(0.80), false, ctx("research"));
    calibrator.recordForecast(makePrediction(0.85), true, ctx("coding"));

    const summary = calibrator.generateCalibrationSummary();
    expect(summary).toContain("Forecast Calibration");
    expect(summary).toContain("By task");
    expect(summary).toContain("research");
    expect(summary).toContain("coding");
    expect(summary).toContain("bias");
    expect(summary).toContain("calibrationError");
    expect(summary).toContain("brier");
  });

  it("should handle empty state gracefully", () => {
    expect(calibrator.getCalibrationStats("task")).toHaveLength(0);
    expect(calibrator.getTaskCalibration("coding")).toBeNull();
    expect(calibrator.generateCalibrationSummary()).toContain("[Forecast Calibration]");
  });

  it("should model calibration feeds into strategy context", () => {
    calibrator.recordForecast(makePrediction(0.90), true, ctx("coding"));
    calibrator.recordForecast(makePrediction(0.85), false, ctx("coding"));

    const codingStats = calibrator.getTaskCalibration("coding");
    expect(codingStats).not.toBeNull();

    const summary = calibrator.generateCalibrationSummary();
    expect(summary).toContain("coding");
    expect(summary).toContain(codingStats!.brierScore.toFixed(3));
  });

  function ctx(taskType: string) {
    return { taskType, strategy: "research_first", provider: "openai", model: "gpt-4o" };
  }
});
