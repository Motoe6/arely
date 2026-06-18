import { ulid } from "ulid";
import type { RuntimeGoal, Replanner, GoalManager } from "./runtime-types.js";

/**
 * Replanner detects failed subtrees and creates compensatory goals.
 *
 * Strategies:
 * 1. If a leaf task fails, create a new goal with higher retry allowance.
 * 2. If a manager node fails, decompose into sub-goals that each retry their children.
 * 3. If the whole tree fails, re-plan the entire goal with adjusted priority.
 */
export class DefaultReplanner implements Replanner {
  private goalManager: GoalManager;

  constructor(goalManager: GoalManager) {
    this.goalManager = goalManager;
  }

  async replanSubtree(goal: RuntimeGoal, failedNodeId: string, error: string): Promise<RuntimeGoal[]> {
    const newGoals: RuntimeGoal[] = [];

    // Create a compensatory sub-goal for the failed node
    const subGoal = this.goalManager.createGoal({
      description: `[Replan:${failedNodeId}] ${goal.description} (recovery from: ${error.slice(0, 100)})`,
      priority: goal.priority + 1, // Higher priority to catch up
      parentGoalId: goal.id,
      dependencies: [goal.id],
      maxRetries: 1,
      tags: ["replan", `failed-node:${failedNodeId}`],
    });
    newGoals.push(subGoal);

    return newGoals;
  }

  async replanGoal(goal: RuntimeGoal): Promise<RuntimeGoal> {
    // Mark old goal as blocked, create a replacement
    this.goalManager.blockGoal(goal.id, "Replanned — replacement created");

    const replacement = this.goalManager.createGoal({
      description: `[Replan] ${goal.description}`,
      priority: goal.priority,
      parentGoalId: goal.parentGoalId,
      dependencies: goal.dependencies.filter(
        (d) => this.goalManager.getGoal(d)?.status === "completed",
      ),
      maxRetries: goal.maxRetries + 1,
      tags: [...goal.tags, "replanned"],
    });

    return replacement;
  }
}
