import type { PredictionCalibrator } from "@arely/engine/llm/prediction-calibrator.js";
import type { Collector, BenchmarkMetric } from "../types.js";

export function createPredictionCollector(
  calibrator: PredictionCalibrator,
): Collector {
  return {
    name: "prediction",
    description: "Forecast calibration metrics: prediction bias, calibration error, and Brier score per dimension",
    collect() {
      const metrics: BenchmarkMetric[] = [];
      const dimensions = ["task", "strategy", "model"] as const;

      for (const dim of dimensions) {
        const stats = calibrator.getCalibrationStats(dim);
        if (stats.length === 0) continue;

        let dimBias = 0;
        let dimCalError = 0;
        let dimBrier = 0;
        let dimObs = 0;

        for (const s of stats) {
          dimBias += s.predictionBias * s.observations;
          dimCalError += s.calibrationError * s.observations;
          dimBrier += s.brierScore * s.observations;
          dimObs += s.observations;

          metrics.push(
            { name: `${dim}_bias__${s.key}`, value: round3(s.predictionBias), unit: "score", threshold: { operator: "lt", value: 0.15 }, passed: Math.abs(s.predictionBias) < 0.15 },
            { name: `${dim}_calibration_error__${s.key}`, value: round3(s.calibrationError), unit: "score", threshold: { operator: "lt", value: 0.20 }, passed: s.calibrationError < 0.20 },
            { name: `${dim}_brier__${s.key}`, value: round3(s.brierScore), unit: "score", threshold: { operator: "lt", value: 0.25 }, passed: s.brierScore < 0.25 },
          );
        }

        if (dimObs > 0) {
          metrics.push(
            { name: `${dim}_avg_bias`, value: round3(dimBias / dimObs), unit: "score", threshold: { operator: "lt", value: 0.15 }, passed: Math.abs(dimBias / dimObs) < 0.15 },
            { name: `${dim}_avg_calibration_error`, value: round3(dimCalError / dimObs), unit: "score", threshold: { operator: "lt", value: 0.20 }, passed: dimCalError / dimObs < 0.20 },
            { name: `${dim}_avg_brier`, value: round3(dimBrier / dimObs), unit: "score", threshold: { operator: "lt", value: 0.25 }, passed: dimBrier / dimObs < 0.25 },
            { name: `${dim}_observations`, value: dimObs, unit: "count" },
          );
        }
      }

      return {
        name: "prediction",
        description: "Forecast calibration metrics across task, strategy, and model dimensions",
        metrics,
      };
    },
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
