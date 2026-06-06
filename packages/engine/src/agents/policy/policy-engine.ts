import type { PolicyRule, PolicyEvaluationInput, PolicyEvaluationResult, PolicyAction, Threshold } from "./policy-types.js";

function meetsThreshold(value: number | undefined, threshold: Threshold | undefined): boolean {
  if (threshold === undefined) return true;
  if (value === undefined) return true;
  if (threshold.gt !== undefined && value <= threshold.gt) return false;
  if (threshold.lt !== undefined && value >= threshold.lt) return false;
  return true;
}

export class PolicyEngine {
  constructor(private rules: PolicyRule[]) {
    for (const rule of rules) {
      if (rule.when.successRate) {
        const keys = Object.keys(rule.when.successRate);
        if (keys.length !== 1 || !("lt" in rule.when.successRate)) {
          throw new Error(
            `Rule ${rule.id}: successRate only supports { lt: number }`,
          );
        }
      }
    }
  }

  evaluate(input: PolicyEvaluationInput): PolicyEvaluationResult[] {
    const results: PolicyEvaluationResult[] = [];

    for (const rule of this.rules) {
      const { when } = rule;
      let matched = true;

      if (when.retryRate) {
        matched = matched && meetsThreshold(input.metrics.retryRate, when.retryRate);
      }

      if (when.successRate) {
        matched = matched && meetsThreshold(input.metrics.successRate, when.successRate);
      }

      if (when.deadLetterRate) {
        matched = matched && meetsThreshold(input.metrics.deadLetterRate, when.deadLetterRate);
      }

      if (when.notificationDeliveryRate) {
        matched = matched && meetsThreshold(input.metrics.notificationDeliveryRate, when.notificationDeliveryRate);
      }

      if (when.circuitBreakerState !== undefined && matched) {
        const anyMatch = Object.values(input.circuitBreakerStates).some(
          (s) => s === when.circuitBreakerState,
        );
        matched = matched && anyMatch;
      }

      let action: PolicyAction | null = null;

      if (matched) {
        action = {
          ruleId: rule.id,
          action: rule.then.type,
          payload: rule.then.payload,
          timestamp: new Date().toISOString(),
        };
      }

      results.push({ ruleId: rule.id, matched, action, guardBlocked: false });
    }

    return results;
  }
}
