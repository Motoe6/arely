import { InMemoryPolicyStore } from "./policy-store.js";
import type { PolicyRule } from "./policy-types.js";

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

export interface PolicyGuardConfig {
  windowMs: number;
}

const DEFAULT_CONFIG: PolicyGuardConfig = {
  windowMs: 3600000,
};

export class PolicyGuard {
  private store: InMemoryPolicyStore;
  private config: PolicyGuardConfig;

  constructor(config?: Partial<PolicyGuardConfig>) {
    this.store = new InMemoryPolicyStore();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  canExecute(rule: PolicyRule, metricsHash: string): GuardResult {
    if (this.store.hasExecutedWith(rule.id, metricsHash)) {
      return { allowed: false, reason: "duplicate metrics snapshot (idempotency)" };
    }

    const count = this.store.getExecutionCount(rule.id, this.config.windowMs);
    if (count >= rule.maxExecutionsPerHour) {
      return { allowed: false, reason: `max ${rule.maxExecutionsPerHour} executions per ${this.config.windowMs}ms reached` };
    }

    const lastExecution = this.store.getLastExecutionTime(rule.id);
    if (lastExecution !== undefined) {
      const elapsed = Date.now() - lastExecution;
      if (elapsed < rule.cooldownMs) {
        return { allowed: false, reason: `cooldown active (${elapsed}ms < ${rule.cooldownMs}ms)` };
      }
    }

    return { allowed: true };
  }

  recordExecution(rule: PolicyRule, metricsHash: string): void {
    this.store.recordExecution(rule.id, metricsHash);
  }
}
