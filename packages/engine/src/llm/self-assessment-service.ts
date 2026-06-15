import { queryDecisions } from "@arelyos/persistence";
import { PredictionCalibrator, predictionCalibrator as defaultCalibrator } from "./prediction-calibrator.js";
import { ModelPerformanceService, modelPerformanceService as defaultModelService } from "./model-performance-service.js";
import { GoalService, goalService as defaultGoalService } from "./goal-service.js";
import type { SelfAssessment, Finding, Recommendation, AssessmentDimension } from "./self-assessment-types.js";

const STRATEGY_STRENGTH_MIN = 0.75;
const STRATEGY_STRENGTH_MIN_OBS = 3;
const STRATEGY_WEAKNESS_MAX = 0.50;
const STRATEGY_WEAKNESS_MIN_OBS = 2;
const MODEL_STRENGTH_MIN = 0.80;
const MODEL_STRENGTH_MIN_OBS = 3;
const MODEL_WEAKNESS_MAX = 0.50;
const MODEL_WEAKNESS_MIN_OBS = 2;
const BIAS_THRESHOLD = 0.15;

export { type SelfAssessment, type Finding, type Recommendation } from "./self-assessment-types.js";

export class SelfAssessmentService {
  private calibrator: PredictionCalibrator;
  private modelService: ModelPerformanceService;
  private goalService: GoalService;

  constructor(deps?: {
    calibrator?: PredictionCalibrator
    modelService?: ModelPerformanceService
    goalService?: GoalService
  }) {
    this.calibrator = deps?.calibrator ?? defaultCalibrator;
    this.modelService = deps?.modelService ?? defaultModelService;
    this.goalService = deps?.goalService ?? defaultGoalService;
  }

  assess(): SelfAssessment {
    const strengths: Finding[] = [];
    const weaknesses: Finding[] = [];

    this.assessStrategies(strengths, weaknesses);
    this.assessModels(strengths, weaknesses);
    this.assessCalibration(weaknesses);
    this.assessGoals(weaknesses);

    const recommendations = this.buildRecommendations(weaknesses);
    const summary = this.buildSummary(strengths, weaknesses, recommendations);

    return { strengths, weaknesses, recommendations, summary };
  }

  private assessStrategies(strengths: Finding[], weaknesses: Finding[]): void {
    const decisions = queryDecisions({});
    const strategyGroups = new Map<string, { successes: number; total: number }>();

    for (const d of decisions) {
      const strategy = d.metadata?.strategy;
      if (typeof strategy !== "string") continue;
      let g = strategyGroups.get(strategy);
      if (!g) {
        g = { successes: 0, total: 0 };
        strategyGroups.set(strategy, g);
      }
      g.total++;
      if (d.outcome === "success") g.successes++;
    }

    for (const [strategy, g] of strategyGroups) {
      const rate = g.successes / g.total;
      if (rate >= STRATEGY_STRENGTH_MIN && g.total >= STRATEGY_STRENGTH_MIN_OBS) {
        strengths.push({
          type: "strength",
          dimension: "strategy",
          label: strategy,
          metric: rate,
          threshold: STRATEGY_STRENGTH_MIN,
          details: `${strategy}: ${g.successes}/${g.total} (${(rate * 100).toFixed(0)}%)`,
        });
      } else if (rate <= STRATEGY_WEAKNESS_MAX && g.total >= STRATEGY_WEAKNESS_MIN_OBS) {
        weaknesses.push({
          type: "weakness",
          dimension: "strategy",
          label: strategy,
          metric: rate,
          threshold: STRATEGY_WEAKNESS_MAX,
          details: `${strategy}: ${g.successes}/${g.total} (${(rate * 100).toFixed(0)}%)`,
        });
      }
    }
  }

  private assessModels(strengths: Finding[], weaknesses: Finding[]): void {
    const snapshots = this.modelService.getSnapshots();

    for (const s of snapshots) {
      if (s.successRate >= MODEL_STRENGTH_MIN && s.executions >= MODEL_STRENGTH_MIN_OBS) {
        strengths.push({
          type: "strength",
          dimension: "model",
          label: `${s.model} for ${s.taskType}`,
          metric: s.successRate,
          threshold: MODEL_STRENGTH_MIN,
          details: `${s.model}/${s.provider} on ${s.taskType}: ${(s.successRate * 100).toFixed(0)}% (${s.executions} execs)`,
        });
      } else if (s.successRate <= MODEL_WEAKNESS_MAX && s.executions >= MODEL_WEAKNESS_MIN_OBS) {
        weaknesses.push({
          type: "weakness",
          dimension: "model",
          label: `${s.model} for ${s.taskType}`,
          metric: s.successRate,
          threshold: MODEL_WEAKNESS_MAX,
          details: `${s.model}/${s.provider} on ${s.taskType}: ${(s.successRate * 100).toFixed(0)}% (${s.executions} execs)`,
        });
      }
    }
  }

  private assessCalibration(weaknesses: Finding[]): void {
    for (const dim of ["task", "strategy", "model"] as const) {
      const stats = this.calibrator.getCalibrationStats(dim);
      for (const s of stats) {
        if (s.observations < 2) continue;
        if (Math.abs(s.predictionBias) >= BIAS_THRESHOLD) {
          const direction = s.predictionBias > 0 ? "underconfident" : "overconfident";
          weaknesses.push({
            type: "weakness",
            dimension: "prediction",
            label: `${dim}:${s.key}`,
            metric: s.predictionBias,
            threshold: BIAS_THRESHOLD,
            details: `${direction} by ${Math.abs(s.predictionBias).toFixed(2)} (${s.observations} obs, calError=${s.calibrationError.toFixed(2)})`,
          });
        }
      }
    }
  }

  private assessGoals(weaknesses: Finding[]): void {
    const active = this.goalService.getActiveGoals();
    for (const g of active) {
      if (g.progressPct === 0) {
        weaknesses.push({
          type: "weakness",
          dimension: "goal_progress",
          label: g.title,
          metric: 0,
          threshold: 1,
          details: `Goal "${g.title}" is active with 0% progress`,
        });
      }
    }
  }

  private buildRecommendations(weaknesses: Finding[]): Recommendation[] {
    return weaknesses.map((w) => {
      switch (w.dimension) {
        case "strategy":
          return {
            dimension: "strategy" as AssessmentDimension,
            label: `Improve ${w.label}`,
            description: `Strategy "${w.label}" has ${(w.metric * 100).toFixed(0)}% success rate. Investigate failure patterns and adjust approach.`,
            expectedImpact: `Increase ${w.label} success rate from ${(w.metric * 100).toFixed(0)}% to target ≥75%`,
          };
        case "model":
          return {
            dimension: "model" as AssessmentDimension,
            label: `Re-evaluate ${w.label}`,
            description: `Model ${w.label} underperforms at ${(w.metric * 100).toFixed(0)}%. Consider alternative models or configurations.`,
            expectedImpact: `Improve success rate for ${w.label}`,
          };
        case "prediction":
          return {
            dimension: "prediction" as AssessmentDimension,
            label: `Calibrate ${w.label}`,
            description: w.details,
            expectedImpact: `Reduce prediction bias for better decision-making`,
          };
        case "goal_progress":
          return {
            dimension: "goal_progress" as AssessmentDimension,
            label: `Progress ${w.label}`,
            description: `Goal "${w.label}" has no progress. Break down into smaller milestones or reassess priority.`,
            expectedImpact: `Unblock ${w.label} and make measurable progress`,
          };
        default:
          return {
            dimension: w.dimension,
            label: `Address ${w.label}`,
            description: w.details,
            expectedImpact: `Improve overall system performance`,
          };
      }
    });
  }

  private buildSummary(strengths: Finding[], weaknesses: Finding[], recommendations: Recommendation[]): string {
    const parts: string[] = [];
    if (strengths.length > 0) {
      parts.push(`Strengths: ${strengths.map((s) => s.label).join(", ")}`);
    }
    if (weaknesses.length > 0) {
      parts.push(`Weaknesses: ${weaknesses.map((w) => w.label).join(", ")}`);
    }
    if (recommendations.length > 0) {
      parts.push(`Recommendations: ${recommendations.length} area(s) for improvement`);
    }
    return parts.join(" | ");
  }
}

export const selfAssessmentService = new SelfAssessmentService();
