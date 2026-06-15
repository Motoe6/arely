import type { ExecutionPrediction } from "./prediction-types.js";

const WEIGHTS = {
  successProbability: 0.7,
  cost: 0.15,
  latency: 0.15,
};

export class PlanScorer {
  score(prediction: ExecutionPrediction): number {
    const successScore = prediction.successProbability * 100;
    const costScore = this.costScore(prediction.expectedCostUsd);
    const latencyScore = this.latencyScore(prediction.expectedLatencyMs);

    return (
      successScore * WEIGHTS.successProbability +
      costScore * WEIGHTS.cost +
      latencyScore * WEIGHTS.latency
    );
  }

  private costScore(usd: number): number {
    if (usd <= 0) return 100;
    if (usd <= 0.001) return 90;
    if (usd <= 0.005) return 70;
    if (usd <= 0.01) return 50;
    if (usd <= 0.05) return 30;
    return 10;
  }

  private latencyScore(ms: number): number {
    if (ms <= 500) return 100;
    if (ms <= 1000) return 80;
    if (ms <= 3000) return 60;
    if (ms <= 5000) return 40;
    if (ms <= 10000) return 20;
    return 5;
  }
}

export const planScorer = new PlanScorer();
