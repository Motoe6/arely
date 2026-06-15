import type { ExecutionPrediction, ForecastRecord, ForecastError, CalibrationStats } from "./prediction-types.js";

export type CalibrationDimension = "task" | "strategy" | "model";

export class PredictionCalibrator {
  private records: ForecastRecord[] = [];

  recordForecast(prediction: ExecutionPrediction, actualSuccess: boolean, context: {
    taskType: string;
    strategy: string;
    provider: string;
    model: string;
  }): ForecastError {
    const predicted = prediction.successProbability;
    const actual: 0 | 1 = actualSuccess ? 1 : 0;
    const error = actual - predicted;
    const absoluteError = Math.abs(error);

    this.records.push({
      predicted,
      actual,
      taskType: context.taskType,
      strategy: context.strategy,
      model: context.model,
      provider: context.provider,
      timestamp: Date.now(),
    });

    return { predicted, actual, error, absoluteError };
  }

  getCalibrationStats(dimension: CalibrationDimension): CalibrationStats[] {
    const grouped = new Map<string, ForecastRecord[]>();

    for (const r of this.records) {
      let key: string;
      switch (dimension) {
        case "task": key = r.taskType; break;
        case "strategy": key = r.strategy; break;
        case "model": key = `${r.provider}/${r.model}`; break;
      }

      let group = grouped.get(key);
      if (!group) {
        group = [];
        grouped.set(key, group);
      }
      group.push(r);
    }

    const results: CalibrationStats[] = [];
    for (const [key, records] of grouped) {
      const n = records.length;
      let sumError = 0;
      let sumAbsError = 0;
      let sumBrier = 0;

      for (const r of records) {
        const error = r.actual - r.predicted;
        sumError += error;
        sumAbsError += Math.abs(error);
        sumBrier += (r.predicted - r.actual) ** 2;
      }

      results.push({
        key,
        observations: n,
        predictionBias: n > 0 ? sumError / n : 0,
        calibrationError: n > 0 ? sumAbsError / n : 0,
        brierScore: n > 0 ? sumBrier / n : 0,
      });
    }

    results.sort((a, b) => b.observations - a.observations);
    return results;
  }

  getTaskCalibration(taskType: string): CalibrationStats | null {
    const all = this.getCalibrationStats("task");
    return all.find((s) => s.key === taskType) ?? null;
  }

  getStrategyCalibration(strategy: string): CalibrationStats | null {
    const all = this.getCalibrationStats("strategy");
    return all.find((s) => s.key === strategy) ?? null;
  }

  getModelCalibration(provider: string, model: string): CalibrationStats | null {
    const all = this.getCalibrationStats("model");
    return all.find((s) => s.key === `${provider}/${model}`) ?? null;
  }

  generateCalibrationSummary(): string {
    const parts: string[] = ["[Forecast Calibration]"];
    for (const dim of ["task", "strategy", "model"] as CalibrationDimension[]) {
      const stats = this.getCalibrationStats(dim);
      if (stats.length === 0) continue;
      parts.push(`\nBy ${dim}:`);
      for (const s of stats.slice(0, 5)) {
        const biasSign = s.predictionBias > 0 ? "+" : "";
        parts.push(
          `  ${s.key}: bias=${biasSign}${s.predictionBias.toFixed(3)}, ` +
          `calibrationError=${s.calibrationError.toFixed(3)}, ` +
          `brier=${s.brierScore.toFixed(3)}, n=${s.observations}`,
        );
      }
    }
    return parts.join("\n");
  }
}

export const predictionCalibrator = new PredictionCalibrator();
