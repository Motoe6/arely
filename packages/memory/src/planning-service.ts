import { ulid } from "ulid";
import {
  createGoalPlan as storeCreateGoalPlan,
  getGoalPlan as storeGetGoalPlan,
  updateGoalPlan as storeUpdateGoalPlan,
  queryGoalPlans as storeQueryGoalPlans,
  deleteGoalPlan as storeDeleteGoalPlan,
  createMilestone as storeCreateMilestone,
  getMilestone as storeGetMilestone,
  updateMilestone as storeUpdateMilestone,
  queryMilestones as storeQueryMilestones,
  deleteMilestone as storeDeleteMilestone,
  getGoal,
  updateGoal,
} from "@arelyos/persistence";
import type { GoalPlan, GoalPlanQuery, Milestone, MilestoneQuery } from "@arelyos/persistence";

export type { GoalPlan, GoalPlanStatus, GoalPlanQuery, Milestone, MilestoneStatus, MilestoneQuery };

export class PlanningService {
  createGoalPlan(data: {
    goalId: string
    title: string
    description: string
    sortOrder?: number
    dependencies?: string[]
    metadata?: Record<string, unknown>
  }): GoalPlan {
    const existing = storeQueryGoalPlans({ goalId: data.goalId });
    const sortOrder = data.sortOrder ?? existing.length;
    return storeCreateGoalPlan({
      id: ulid(),
      goalId: data.goalId,
      title: data.title,
      description: data.description,
      sortOrder,
      dependencies: data.dependencies ?? [],
      metadata: data.metadata ?? {},
    });
  }

  getGoalPlan(id: string): GoalPlan | null {
    return storeGetGoalPlan(id);
  }

  advanceGoalPlan(id: string): boolean {
    return storeUpdateGoalPlan(id, { status: "in_progress" });
  }

  failGoalPlan(id: string): boolean {
    return storeUpdateGoalPlan(id, { status: "failed" });
  }

  resumeGoalPlan(id: string): boolean {
    return storeUpdateGoalPlan(id, { status: "in_progress" });
  }

  completeGoalPlan(id: string): boolean {
    const result = storeUpdateGoalPlan(id, { status: "completed", progressPct: 100 });
    if (result) {
      const plan = storeGetGoalPlan(id);
      if (plan) {
        this.computeGoalProgress(plan.goalId);
      }
    }
    return result;
  }

  updateGoalPlanProgress(id: string, pct: number): boolean {
    const result = storeUpdateGoalPlan(id, { progressPct: Math.max(0, Math.min(100, pct)) });
    if (result) {
      const plan = storeGetGoalPlan(id);
      if (plan) {
        this.computeGoalProgress(plan.goalId);
      }
    }
    return result;
  }

  listGoalPlans(q?: GoalPlanQuery): GoalPlan[] {
    return storeQueryGoalPlans(q ?? {});
  }

  deleteGoalPlan(id: string): boolean {
    return storeDeleteGoalPlan(id);
  }

  createMilestone(data: {
    planId: string
    description: string
    weight?: number
    metadata?: Record<string, unknown>
  }): Milestone {
    return storeCreateMilestone({
      id: ulid(),
      planId: data.planId,
      description: data.description,
      weight: data.weight,
      metadata: data.metadata ?? {},
    });
  }

  getMilestone(id: string): Milestone | null {
    return storeGetMilestone(id);
  }

  completeMilestone(id: string): boolean {
    const now = new Date().toISOString();
    const result = storeUpdateMilestone(id, { status: "completed", completedAt: now });
    if (result) {
      const ms = storeGetMilestone(id);
      if (ms) {
        this._recomputeGoalPlanProgress(ms.planId);
      }
    }
    return result;
  }

  listMilestones(q?: MilestoneQuery): Milestone[] {
    return storeQueryMilestones(q ?? {});
  }

  deleteMilestone(id: string): boolean {
    return storeDeleteMilestone(id);
  }

  _recomputeGoalPlanProgress(planId: string): void {
    const msList = storeQueryMilestones({ planId });
    const total = msList.length;
    if (total === 0) return;
    const completed = msList.filter((m) => m.status === "completed").length;
    const pct = Math.round((completed / total) * 100);

    storeUpdateGoalPlan(planId, { progressPct: pct });

    if (pct === 100) {
      storeUpdateGoalPlan(planId, { status: "completed" });
    } else if (pct > 0) {
      const plan = storeGetGoalPlan(planId);
      if (plan && plan.status === "pending") {
        storeUpdateGoalPlan(planId, { status: "in_progress" });
      }
    }

    const plan = storeGetGoalPlan(planId);
    if (plan) {
      this.computeGoalProgress(plan.goalId);
    }
  }

  computeGoalProgress(goalId: string): void {
    const plans = storeQueryGoalPlans({ goalId });
    const total = plans.length;
    if (total === 0) return;

    const sumPct = plans.reduce((acc, p) => acc + p.progressPct, 0);
    const avgPct = Math.round(sumPct / total);

    const allCompleted = plans.every((p) => p.status === "completed");
    const allFailed = plans.every((p) => p.status === "failed");

    const goalStatus = allCompleted ? ("completed" as const) : allFailed ? ("abandoned" as const) : undefined;

    updateGoal(goalId, {
      progressPct: avgPct,
      ...(goalStatus ? { status: goalStatus } : {}),
      ...(goalStatus === "completed" ? { completedAt: new Date().toISOString() } : {}),
    });
  }

  getGoalProgress(goalId: string): {
    completedPlans: number
    totalPlans: number
    goalProgressPct: number
  } {
    const plans = storeQueryGoalPlans({ goalId });
    const total = plans.length;
    const completed = plans.filter((p) => p.status === "completed").length;
    const goal = getGoal(goalId);
    return {
      completedPlans: completed,
      totalPlans: total,
      goalProgressPct: goal?.progressPct ?? 0,
    };
  }
}

export const planningService = new PlanningService();
