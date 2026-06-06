import { ulid } from "ulid";
import { TimeoutError, CancelledError, CircuitBreakerOpenError } from "./errors.js";
import type { RetryAttemptEvent } from "../types/events.js";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  enabled: boolean;
}

type EventEmitter = (event: RetryAttemptEvent) => void;

const jitter = () => Math.random() * 100;

function isNonRetryable(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof CancelledError) return true;
  if (err instanceof CircuitBreakerOpenError) return true;
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  emit: EventEmitter,
  meta?: { toolName?: string; correlationId?: string },
  signal?: AbortSignal,
): Promise<T> {
  if (!options.enabled) return fn();

  let lastErr: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isNonRetryable(err)) throw err;
      if (attempt === options.maxAttempts) throw err;

      const delayMs = Math.min(
        options.baseDelayMs * 2 ** (attempt - 1) + jitter(),
        options.maxDelayMs,
      );

      const event: RetryAttemptEvent = {
        id: ulid(),
        version: 1,
        timestamp: Date.now(),
        type: "retry_attempt",
        toolName: meta?.toolName ?? "unknown",
        attempt,
        maxAttempts: options.maxAttempts,
        delayMs,
        error: err instanceof Error ? err.message : String(err),
      };
      if (meta?.correlationId) event.correlationId = meta.correlationId;
      emit(event);

      await sleep(delayMs, signal);
    }
  }
  throw lastErr;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError("Operation cancelled during retry delay"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError("Operation cancelled during retry delay"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
