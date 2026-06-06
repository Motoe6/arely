export type RetryStrategy = "fixed" | "linear" | "exponential" | "exponential_jitter";

export type ExecutionErrorKind =
  | "timeout"
  | "cancelled"
  | "permission"
  | "validation"
  | "dependency_failed"
  | "tool_error"
  | "internal";

export interface StepExecutionContract {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  retryStrategy?: RetryStrategy;
  idempotent?: boolean;
  retryableErrors?: ExecutionErrorKind[];
}

export const VALID_RETRY_STRATEGIES: readonly RetryStrategy[] = [
  "fixed",
  "linear",
  "exponential",
  "exponential_jitter",
] as const;

export const VALID_ERROR_KINDS: readonly ExecutionErrorKind[] = [
  "timeout",
  "cancelled",
  "permission",
  "validation",
  "dependency_failed",
  "tool_error",
  "internal",
] as const;
