import { CircuitBreaker, type BreakerOptions } from "../tools/circuit-breaker.js";
import { CircuitBreakerOpenError } from "../tools/errors.js";
import { classifyExecutionError } from "./error-classifier.js";
import type { ExecutionErrorKind } from "./execution-contract.js";

export type { BreakerOptions };

export interface CircuitBreakerState {
  toolName: string;
  state: "closed" | "open" | "half_open";
  failures: number;
  lastFailureAt: string | null;
  openedAt: string | null;
  lastErrorKind: ExecutionErrorKind | null;
}

export class PipelineCircuitBreakerRegistry {
  private breaker: CircuitBreaker;
  private errorKinds = new Map<string, ExecutionErrorKind | null>();
  private lastFailureAts = new Map<string, number>();
  private openedAts = new Map<string, number>();
  private threshold: number;

  constructor(options: BreakerOptions) {
    this.breaker = new CircuitBreaker(options, () => {});
    this.threshold = options.threshold;
  }

  async execute<T>(toolName: string, errorKind: ExecutionErrorKind | null, fn: () => Promise<T>): Promise<T> {
    try {
      const result = await this.breaker.call(toolName, fn);
      this.errorKinds.set(toolName, null);
      return result;
    } catch (err) {
      if (err instanceof CircuitBreakerOpenError) {
        const raw = this.breaker.getState(toolName);
        this.errorKinds.set(toolName, "dependency_failed");
        this.lastFailureAts.set(toolName, Date.now());
        if (raw.status === "open" && !this.openedAts.has(toolName)) {
          this.openedAts.set(toolName, Date.now());
        }
        throw err;
      }
      this.errorKinds.set(toolName, errorKind ?? classifyExecutionError(err));
      this.lastFailureAts.set(toolName, Date.now());
      const raw = this.breaker.getState(toolName);
      if (raw.status === "open") {
        this.openedAts.set(toolName, Date.now());
      }
      throw err;
    }
  }

  getState(toolName: string): CircuitBreakerState {
    const raw = this.breaker.getState(toolName);
    return {
      toolName,
      state: raw.status,
      failures: raw.failureCount,
      lastFailureAt: this.lastFailureAts.has(toolName) ? new Date(this.lastFailureAts.get(toolName)!).toISOString() : null,
      openedAt: this.openedAts.has(toolName) ? new Date(this.openedAts.get(toolName)!).toISOString() : null,
      lastErrorKind: this.errorKinds.get(toolName) ?? null,
    };
  }

  getAllStates(): CircuitBreakerState[] {
    const toolNames = new Set([
      ...Array.from(this.errorKinds.keys()),
    ]);
    return Array.from(toolNames).map((tn) => this.getState(tn));
  }

  reset(toolName: string): void {
    this.breaker.reset(toolName);
    this.errorKinds.delete(toolName);
    this.lastFailureAts.delete(toolName);
    this.openedAts.delete(toolName);
  }

  resetAll(): string[] {
    const toolNames = Array.from(this.errorKinds.keys());
    for (const tn of toolNames) {
      this.reset(tn);
    }
    return toolNames;
  }

  shouldOpenBreaker(_toolName: string, _errorKind: ExecutionErrorKind | null, failureCount: number): boolean {
    return failureCount >= this.threshold;
  }
}
