import { createHash } from "node:crypto";
import type { PolicyEvaluationInput } from "./policy-types.js";

function round(value: number | undefined, decimals = 4): number | undefined {
  if (value === undefined) return undefined;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function canonicalize(input: PolicyEvaluationInput): Record<string, unknown> {
  return {
    metrics: {
      deadLetterRate: round(input.metrics.deadLetterRate),
      notificationDeliveryRate: round(input.metrics.notificationDeliveryRate),
      retryRate: round(input.metrics.retryRate),
      successRate: round(input.metrics.successRate),
    },
    circuitBreakerStates: Object.fromEntries(
      Object.entries(input.circuitBreakerStates).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

export function createMetricsHash(input: PolicyEvaluationInput): string {
  const normalized = canonicalize(input);
  const json = JSON.stringify(normalized);
  return createHash("sha256").update(json).digest("hex");
}
