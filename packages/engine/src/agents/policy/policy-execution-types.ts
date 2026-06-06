import type { PolicyAction } from "./policy-types.js";
import type { Tracer } from "../../tracer.js";

export interface PolicyActionHandlers {
  trigger_remediation: (payload: unknown) => Promise<void>;
  reset_circuit_breaker: (payload: unknown) => Promise<void>;
  escalate_alert: (payload: unknown) => Promise<void>;
}

export interface PolicyExecutionResult {
  action: PolicyAction;
  status: "success" | "failed" | "skipped";
  error?: string;
  startedAt: number;
  finishedAt: number;
}

export interface PolicyExecutorConfig {
  handlerTimeoutMs: number;
  tracer?: Tracer;
}
