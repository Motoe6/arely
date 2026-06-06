export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Tool timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export class CancelledError extends Error {
  constructor(message?: string) {
    super(message ?? "Tool was cancelled");
    this.name = "CancelledError";
  }
}

export class CircuitBreakerOpenError extends Error {
  readonly toolName: string;
  constructor(toolName: string) {
    super(`Circuit breaker is open for tool: ${toolName}`);
    this.name = "CircuitBreakerOpenError";
    this.toolName = toolName;
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeoutPromise = new Promise<T>((_, reject) => {
    setTimeout(() => { reject(new TimeoutError(ms)); }, ms);
  });
  timeoutPromise.catch(() => { /* suppress unhandled rejection from Promise.race */ });
  return Promise.race([promise, timeoutPromise]);
}

export function withTimeoutSignal<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), ms);

  const onExternalAbort = () => { controller.abort(); };
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  const promise = fn(controller.signal);

  const cleanup = () => {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  };

  return withTimeout(promise, ms)
    .finally(cleanup)
    .catch((err) => {
      if (externalSignal?.aborted) {
        throw new CancelledError();
      }
      if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") {
        throw new TimeoutError(ms);
      }
      throw err;
    });
}
