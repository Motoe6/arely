import type { ExecutionPrediction } from "./prediction-types.js";

export type GateAction = "execute" | "monitor" | "replan" | "ask_user" | "abort";

export interface GateDecision {
  action: GateAction;
  reason: string;
}

export interface GateConfig {
  budgetUsd?: number;
  lowThreshold?: number;
  mediumThreshold?: number;
  catastrophicThreshold?: number;
}

const DEFAULTS: Required<GateConfig> = {
  budgetUsd: 0.05,
  lowThreshold: 0.85,
  mediumThreshold: 0.60,
  catastrophicThreshold: 0.30,
};

export class ExecutionGate {
  private config: Required<GateConfig>;

  constructor(config?: GateConfig) {
    this.config = { ...DEFAULTS, ...config };
  }

  decide(prediction: ExecutionPrediction): GateDecision {
    if (prediction.expectedCostUsd > this.config.budgetUsd) {
      return {
        action: "ask_user",
        reason: `Cost $${prediction.expectedCostUsd.toFixed(4)} exceeds budget $${this.config.budgetUsd.toFixed(4)}`,
      };
    }

    if (prediction.successProbability < this.config.catastrophicThreshold) {
      return {
        action: "abort",
        reason: `Success probability ${(prediction.successProbability * 100).toFixed(0)}% is below catastrophic threshold ${(this.config.catastrophicThreshold * 100).toFixed(0)}%`,
      };
    }

    if (prediction.successProbability >= this.config.lowThreshold) {
      return {
        action: "execute",
        reason: `Success probability ${(prediction.successProbability * 100).toFixed(0)}% is at or above low-risk threshold ${(this.config.lowThreshold * 100).toFixed(0)}%`,
      };
    }

    if (prediction.successProbability >= this.config.mediumThreshold) {
      return {
        action: "monitor",
        reason: `Success probability ${(prediction.successProbability * 100).toFixed(0)}% is at or above medium-risk threshold ${(this.config.mediumThreshold * 100).toFixed(0)}%`,
      };
    }

    return {
      action: "replan",
      reason: `Success probability ${(prediction.successProbability * 100).toFixed(0)}% is below medium-risk threshold ${(this.config.mediumThreshold * 100).toFixed(0)}%`,
    };
  }
}
