import type { ExecutionPrediction } from "./prediction-types.js";
import { queryGoals, queryGoalPlans, queryMilestones } from "@arely/persistence";
import type { InjectedMemoryMessage } from "@arely/memory";
import { GoalUtilityScorer } from "./goal-utility-scorer.js";
import type { ResumeContext, PrioritizedMilestone } from "./goal-resume-types.js";

const DEFAULT_PREDICTION: ExecutionPrediction = {
  successProbability: 0.5,
  expectedCostUsd: 0,
  expectedLatencyMs: 0,
  confidence: 0.5,
  risk: "medium",
  rationale: ["resume context"],
};

export type { ResumeContext, PrioritizedMilestone } from "./goal-resume-types.js";

export class GoalResumeService {
  private scorer: GoalUtilityScorer;

  constructor(scorer?: GoalUtilityScorer) {
    this.scorer = scorer ?? new GoalUtilityScorer();
  }

  buildResumeContext(sessionId: string, limit: number = 5): ResumeContext {
    const activeGoals = queryGoals({ status: "active" });
    const allPlans: ResumeContext["plans"] = [];
    const allMilestones: ResumeContext["milestones"] = [];
    const prioritizedMilestones: PrioritizedMilestone[] = [];

    for (const goal of activeGoals) {
      const plans = queryGoalPlans({ goalId: goal.id });
      allPlans.push(...plans);

      for (const plan of plans) {
        const milestones = queryMilestones({ planId: plan.id });
        allMilestones.push(...milestones);

        const pending = milestones.filter((m) => m.status === "pending");
        for (const ms of pending) {
          const forecast = this.scorer.score({
            goalId: goal.id,
            planId: plan.id,
            milestoneId: ms.id,
            prediction: DEFAULT_PREDICTION,
          });

          prioritizedMilestones.push({
            milestoneId: ms.id,
            goalId: goal.id,
            planId: plan.id,
            utility: forecast.expectedUtility,
            description: ms.description,
          });
        }
      }
    }

    prioritizedMilestones.sort((a, b) => b.utility - a.utility);

    if (prioritizedMilestones.length > limit) {
      prioritizedMilestones.length = limit;
    }

    return {
      activeGoals,
      plans: allPlans,
      milestones: allMilestones,
      prioritizedMilestones,
    };
  }

  injectResumeContext(sessionId: string, limit: number = 5): InjectedMemoryMessage[] {
    const ctx = this.buildResumeContext(sessionId, limit);

    if (ctx.activeGoals.length === 0) {
      return [];
    }

    const lines: string[] = [];

    for (const goal of ctx.activeGoals) {
      lines.push(`Goal: ${goal.title}`);
      lines.push(`Progress: ${goal.progressPct}%`);

      const goalPlans = ctx.plans.filter((p) => p.goalId === goal.id);
      if (goalPlans.length > 0) {
        const active = goalPlans.filter((p) => p.status === "in_progress" || p.status === "pending");
        const currentPlan = active.length > 0 ? active[0].title : null;
        if (currentPlan) {
          lines.push(`Current Plan: ${currentPlan}`);
        }
      }

      lines.push("");
    }

    if (ctx.prioritizedMilestones.length > 0) {
      lines.push("Highest Utility Tasks:");
      ctx.prioritizedMilestones.forEach((pm, i) => {
        lines.push(`  ${i + 1}. ${pm.description}`);
        lines.push(`     Utility: ${pm.utility.toFixed(1)}`);
      });
    }

    return [
      {
        role: "system",
        content: `[Goal Resume]\n${lines.join("\n")}`,
        timestamp: Date.now(),
      },
    ];
  }
}

export const goalResumeService = new GoalResumeService();
