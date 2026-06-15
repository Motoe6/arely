import type { GoalForecast, GoalForecastContext } from "./goal-forecast-types.js";
import type { ExecutionPrediction } from "./prediction-types.js";
import { getGoal, getMilestone, queryGoalPlans, queryMilestones } from "@arely/persistence";

export class GoalUtilityScorer {
  score(ctx: GoalForecastContext): GoalForecast {
    const goal = getGoal(ctx.goalId);
    if (!goal) {
      return {
        goalId: ctx.goalId,
        predictedSuccessPct: 0,
        currentProgressPct: 0,
        predictedProgressGainPct: 0,
        expectedUtility: 0,
        confidence: 0,
        rationale: "Goal not found",
      };
    }

    const gain = this.computeGain(ctx.goalId, ctx.planId, ctx.milestoneId);
    const raw = ctx.prediction.successProbability * gain;
    const expectedUtility = Math.round(raw * 100) / 100;

    const rationale = this.buildRationale(goal.progressPct, gain, ctx.prediction, expectedUtility);

    return {
      goalId: ctx.goalId,
      predictedSuccessPct: Math.round(ctx.prediction.successProbability * 100),
      currentProgressPct: goal.progressPct,
      predictedProgressGainPct: gain,
      expectedUtility,
      confidence: ctx.prediction.confidence,
      rationale,
    };
  }

  scoreGoal(goalId: string, prediction: ExecutionPrediction): GoalForecast {
    const ctx: GoalForecastContext = { goalId, prediction };
    return this.score(ctx);
  }

  private computeGain(goalId: string, planId?: string, milestoneId?: string): number {
    if (milestoneId) {
      return this.computeMilestoneGain(goalId, milestoneId);
    }
    if (planId) {
      return this.computePlanGain(goalId, planId);
    }
    return this.computeAverageGain(goalId);
  }

  private computeMilestoneGain(goalId: string, milestoneId: string): number {
    const allPlans = queryGoalPlans({ goalId });
    let allMilestones: { weight: number; planId: string }[] = [];

    for (const plan of allPlans) {
      const msList = queryMilestones({ planId: plan.id });
      for (const ms of msList) {
        allMilestones.push({ weight: ms.weight, planId: ms.planId });
      }
    }

    const target = getMilestone(milestoneId);
    if (!target) return 0;

    const totalWeight = allMilestones.reduce((s, m) => s + m.weight, 0);
    if (totalWeight === 0) return 0;

    return Math.round((target.weight / totalWeight) * 1000) / 10;
  }

  private computePlanGain(goalId: string, planId: string): number {
    const allPlans = queryGoalPlans({ goalId });
    const totalProgress = allPlans.reduce((s, p) => s + p.progressPct, 0);
    const avgProgress = allPlans.length > 0 ? totalProgress / allPlans.length : 0;

    const target = allPlans.find((p) => p.id === planId);
    if (!target) return 0;

    const remaining = 100 - target.progressPct;
    const planShare = allPlans.length > 0 ? 100 / allPlans.length : 0;
    const gain = (remaining / 100) * planShare;
    return Math.round(gain * 10) / 10;
  }

  private computeAverageGain(goalId: string): number {
    const allPlans = queryGoalPlans({ goalId });
    if (allPlans.length === 0) return 0;

    let allMilestones: { weight: number }[] = [];
    for (const plan of allPlans) {
      const msList = queryMilestones({ planId: plan.id });
      for (const ms of msList) {
        allMilestones.push({ weight: ms.weight });
      }
    }
    if (allMilestones.length === 0) return 0;

    const totalWeight = allMilestones.reduce((s, m) => s + m.weight, 0);
    const avgGain = (totalWeight / allMilestones.length / totalWeight) * 100;
    return Math.round(avgGain * 10) / 10;
  }

  private buildRationale(
    currentProgress: number,
    gain: number,
    prediction: ExecutionPrediction,
    utility: number,
  ): string {
    const pct = (prediction.successProbability * 100).toFixed(0);
    return [
      `Goal at ${currentProgress}%`,
      `Expected gain: ${gain.toFixed(1)}%`,
      `P(success)=${pct}%`,
      `Utility=${utility.toFixed(2)}`,
    ].join(" | ");
  }
}

export const goalUtilityScorer = new GoalUtilityScorer();
