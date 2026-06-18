import type { Policy, PolicyEngine, PolicyVerdict, RuntimeGoal } from "./runtime-types.js";

const DEFAULT_POLICIES: Policy[] = [
  { name: "maxGoalRetries", value: 3, description: "Maximum retries per goal before failing permanently" },
  { name: "maxTreeDepth", value: 5, description: "Maximum depth of hierarchical manager tree" },
  { name: "autoReplan", value: true, description: "Automatically replan failed subtrees" },
  { name: "allowDistributedExecution", value: true, description: "Allow dispatching to remote workers" },
  { name: "allowCrossSessionMemory", value: true, description: "Allow storing results in cross-session memory" },
  { name: "maxRuntimeMinutes", value: 30, description: "Maximum wall-clock time for a single goal" },
  { name: "maxActiveGoals", value: 10, description: "Maximum concurrent active goals" },
];

/**
 * Configurable policy engine for the autonomous runtime.
 *
 * Checks goals against policies before execution.
 * Policies can be updated at runtime.
 */
export class DefaultPolicyEngine implements PolicyEngine {
  private policies: Map<string, unknown>;

  constructor(initial?: Record<string, unknown>) {
    this.policies = new Map(
      DEFAULT_POLICIES.map((p) => [p.name, p.value]),
    );
    if (initial) {
      for (const [key, value] of Object.entries(initial)) {
        this.policies.set(key, value);
      }
    }
  }

  check(goal: RuntimeGoal): PolicyVerdict {
    const retries = this.policies.get("maxGoalRetries") as number;
    if (goal.retries >= retries) {
      return {
        allowed: false,
        reason: `Goal exceeded max retries (${goal.retries}/${retries})`,
        policy: "maxGoalRetries",
      };
    }

    const maxActive = this.policies.get("maxActiveGoals") as number;
    // Active count check is done by the caller; this is a soft signal

    return { allowed: true };
  }

  getAllPolicies(): Policy[] {
    return DEFAULT_POLICIES.map((p) => ({
      ...p,
      value: this.policies.get(p.name) ?? p.value,
    }));
  }

  updatePolicy(name: string, value: unknown): void {
    this.policies.set(name, value);
  }

  getPolicyValue(name: string): unknown {
    return this.policies.get(name);
  }
}
