import { ulid } from "ulid";
import type { RuntimeGoal, RuntimeGoalStatus, GoalManager } from "./runtime-types.js";

interface GoalRecord extends RuntimeGoal {
  _history: Array<{ status: RuntimeGoalStatus; timestamp: number; error?: string }>;
}

/**
 * In-memory GoalManager with optional persistence hook.
 *
 * Manages goals, their lifecycle (pending → running → completed|failed),
 * dependency resolution, and history tracking.
 */
export class DefaultGoalManager implements GoalManager {
  private goals = new Map<string, GoalRecord>();
  private history: RuntimeGoal[] = [];

  createGoal(opts: {
    description: string;
    priority?: number;
    parentGoalId?: string;
    dependencies?: string[];
    maxRetries?: number;
    tags?: string[];
  }): RuntimeGoal {
    const now = Date.now();
    const goal: GoalRecord = {
      id: ulid(),
      description: opts.description,
      priority: opts.priority ?? 0,
      status: "pending",
      parentGoalId: opts.parentGoalId,
      dependencies: opts.dependencies ?? [],
      retries: 0,
      maxRetries: opts.maxRetries ?? 3,
      createdAt: now,
      updatedAt: now,
      tags: opts.tags ?? [],
      _history: [{ status: "pending", timestamp: now }],
    };
    this.goals.set(goal.id, goal);
    return this.sanitize(goal);
  }

  getGoal(id: string): RuntimeGoal | undefined {
    const g = this.goals.get(id);
    return g ? this.sanitize(g) : undefined;
  }

  updateGoal(id: string, updates: Partial<RuntimeGoal>): void {
    const g = this.goals.get(id);
    if (!g) return;
    Object.assign(g, updates, { updatedAt: Date.now() });
  }

  listGoals(status?: RuntimeGoalStatus): RuntimeGoal[] {
    const all = [...this.goals.values()];
    if (status) return all.filter((g) => g.status === status).map(this.sanitize);
    return all.map(this.sanitize);
  }

  /**
   * Returns goals that are:
   * - pending (not running, not blocked, not completed, not failed)
   * - all dependencies are completed
   * - no policy rejection (caller checks policies)
   */
  getRunnableGoals(): RuntimeGoal[] {
    return [...this.goals.values()]
      .filter((g) => {
        if (g.status !== "pending") return false;
        // All dependencies must be completed
        return g.dependencies.every((depId) => {
          const dep = this.goals.get(depId);
          return dep?.status === "completed";
        });
      })
      .map(this.sanitize);
  }

  blockGoal(id: string, reason: string): void {
    const g = this.goals.get(id);
    if (!g) return;
    g.status = "blocked";
    g.lastError = reason;
    g.updatedAt = Date.now();
    g._history.push({ status: "blocked", timestamp: Date.now(), error: reason });
  }

  completeGoal(id: string): void {
    const g = this.goals.get(id);
    if (!g) return;
    g.status = "completed";
    g.completedAt = Date.now();
    g.updatedAt = Date.now();
    g._history.push({ status: "completed", timestamp: Date.now() });
    this.history.push(this.sanitize(g));
  }

  failGoal(id: string, error: string): void {
    const g = this.goals.get(id);
    if (!g) return;
    g.retries++;
    if (g.retries >= g.maxRetries) {
      g.status = "failed";
      g.lastError = error;
      g._history.push({ status: "failed", timestamp: Date.now(), error });
      this.history.push(this.sanitize(g));
    } else {
      // Reset to pending for retry
      g.status = "pending";
      g.lastError = error;
      g.updatedAt = Date.now();
      g._history.push({ status: "pending", timestamp: Date.now(), error });
    }
  }

  listActive(): RuntimeGoal[] {
    return [...this.goals.values()]
      .filter((g) => g.status === "pending" || g.status === "running" || g.status === "blocked")
      .map(this.sanitize);
  }

  getHistory(limit = 50): RuntimeGoal[] {
    return this.history.slice(-limit);
  }

  getActiveCount(): number {
    return [...this.goals.values()].filter(
      (g) => g.status === "pending" || g.status === "running",
    ).length;
  }

  private sanitize(g: GoalRecord): RuntimeGoal {
    const { _history: _, ...rest } = g;
    return rest;
  }
}
