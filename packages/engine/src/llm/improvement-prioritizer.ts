import { GoalUtilityScorer, goalUtilityScorer as defaultScorer } from "./goal-utility-scorer.js";
import type { ExecutionPrediction } from "./prediction-types.js";
import type { GoalForecast } from "./goal-forecast-types.js";
import type { ImprovementGenerationResult, GeneratedImprovement } from "./improvement-generator-types.js";
import type { PrioritizationResult, PrioritizedImprovement } from "./improvement-prioritization-types.js";

const DEFAULT_PREDICTION: ExecutionPrediction = {
  successProbability: 0.5,
  expectedCostUsd: 0,
  expectedLatencyMs: 0,
  confidence: 0.5,
  risk: "medium",
  rationale: ["neutral baseline for prioritization"],
};

export { type PrioritizationResult, type PrioritizedImprovement } from "./improvement-prioritization-types.js";

export class ImprovementPrioritizer {
  private scorer: GoalUtilityScorer;

  constructor(deps?: { scorer?: GoalUtilityScorer }) {
    this.scorer = deps?.scorer ?? defaultScorer;
  }

  prioritize(result: ImprovementGenerationResult): PrioritizationResult {
    const scored: { improvement: GeneratedImprovement; forecast: GoalForecast }[] = [];

    for (const imp of result.improvements) {
      const forecast = this.scorer.scoreGoal(imp.goal.id, DEFAULT_PREDICTION);
      scored.push({ improvement: imp, forecast });
    }

    scored.sort((a, b) => b.forecast.expectedUtility - a.forecast.expectedUtility);

    const prioritized = scored.map((s, i) => ({
      improvement: s.improvement,
      rank: i + 1,
      expectedUtility: s.forecast.expectedUtility,
      predictedProgressGainPct: s.forecast.predictedProgressGainPct,
      predictedSuccessPct: s.forecast.predictedSuccessPct,
      confidence: s.forecast.confidence,
    }));

    return {
      prioritized,
      totalScored: prioritized.length,
      summary: prioritized.length > 0
        ? `Prioritized ${prioritized.length} improvement(s): #1 ${prioritized[0].improvement.recommendationLabel} (utility=${prioritized[0].expectedUtility})`
        : "No improvements to prioritize",
    };
  }
}

export const improvementPrioritizer = new ImprovementPrioritizer();
