import type { RetryStrategy } from "./execution-contract.js";

export function computeDelay(
  attempt: number,
  baseMs: number,
  strategy: RetryStrategy,
  maxDelayMs = 60000,
): number {
  let delay: number;
  switch (strategy) {
    case "fixed":
      delay = baseMs;
      break;
    case "linear":
      delay = baseMs * attempt;
      break;
    case "exponential":
      delay = baseMs * 2 ** (attempt - 1);
      break;
    case "exponential_jitter":
      delay = Math.random() * (baseMs * 2 ** (attempt - 1));
      break;
  }
  return Math.min(delay, maxDelayMs);
}
