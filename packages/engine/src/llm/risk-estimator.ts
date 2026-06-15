import type { ExecutionPrediction } from "./prediction-types.js";

export class RiskEstimator {
  estimate(prediction: ExecutionPrediction): "low" | "medium" | "high" {
    if (prediction.successProbability >= 0.85) return "low";
    if (prediction.successProbability >= 0.60) return "medium";
    return "high";
  }

  getRecommendation(risk: "low" | "medium" | "high"): string {
    switch (risk) {
      case "low":
        return "execute immediately";
      case "medium":
        return "execute with monitoring";
      case "high":
        return "replan or ask for clarification";
    }
  }
}

export const riskEstimator = new RiskEstimator();
