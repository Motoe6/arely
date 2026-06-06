export type BreakerStatus = "closed" | "open" | "half_open";

export type CircuitBreakerMap = Record<string, BreakerStatus>;

export interface Threshold {
  gt?: number;
  lt?: number;
}

export interface SuccessThreshold {
  lt: number;
}

export interface MetricConditions {
  retryRate?: Threshold;
  successRate?: SuccessThreshold;
  deadLetterRate?: Threshold;
  circuitBreakerState?: BreakerStatus;
  notificationDeliveryRate?: Threshold;
}

export type PolicyActionType = "trigger_remediation" | "reset_circuit_breaker" | "escalate_alert";

export interface PolicyAction {
  ruleId: string;
  action: PolicyActionType;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface PolicyRule {
  id: string;
  when: MetricConditions;
  then: {
    type: PolicyActionType;
    payload: Record<string, unknown>;
  };
  cooldownMs: number;
  maxExecutionsPerHour: number;
}

export interface PolicyEvaluationInput {
  metrics: {
    retryRate?: number;
    successRate?: number;
    deadLetterRate?: number;
    notificationDeliveryRate?: number;
  };
  circuitBreakerStates: CircuitBreakerMap;
}

export interface PolicyEvaluationResult {
  ruleId: string;
  matched: boolean;
  action: PolicyAction | null;
  guardBlocked: boolean;
  guardReason?: string;
}
