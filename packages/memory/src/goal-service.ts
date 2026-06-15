import { ulid } from "ulid";
import {
  createGoal as storeCreateGoal,
  getGoal as storeGetGoal,
  updateGoal as storeUpdateGoal,
  queryGoals as storeQueryGoals,
  countGoals as storeCountGoals,
  deleteGoal as storeDeleteGoal,
} from "@arely/persistence";
import type { Goal, GoalStatus, GoalQuery } from "@arely/persistence";

export type { Goal, GoalStatus, GoalQuery };

export class GoalService {
  createGoal(data: {
    title: string
    description: string
    priority?: number
    metadata?: Record<string, unknown>
  }): Goal {
    return storeCreateGoal({
      id: ulid(),
      title: data.title,
      description: data.description,
      priority: data.priority ?? 0,
      metadata: data.metadata ?? {},
    });
  }

  getGoal(id: string): Goal | null {
    return storeGetGoal(id);
  }

  updateGoal(id: string, updates: {
    title?: string
    description?: string
    status?: GoalStatus
    priority?: number
    progressPct?: number
    completedAt?: string | null
    metadata?: Record<string, unknown>
  }): boolean {
    return storeUpdateGoal(id, updates);
  }

  completeGoal(id: string): boolean {
    const now = new Date().toISOString();
    return storeUpdateGoal(id, { status: "completed", completedAt: now, progressPct: 100 });
  }

  pauseGoal(id: string): boolean {
    return storeUpdateGoal(id, { status: "paused" });
  }

  abandonGoal(id: string): boolean {
    return storeUpdateGoal(id, { status: "abandoned" });
  }

  listGoals(q?: GoalQuery): Goal[] {
    return storeQueryGoals(q ?? {});
  }

  deleteGoal(id: string): boolean {
    return storeDeleteGoal(id);
  }

  getActiveGoals(): Goal[] {
    return storeQueryGoals({ status: "active" });
  }

  updateProgress(id: string, pct: number): boolean {
    return storeUpdateGoal(id, { progressPct: Math.max(0, Math.min(100, pct)) });
  }
}

export const goalService = new GoalService();
