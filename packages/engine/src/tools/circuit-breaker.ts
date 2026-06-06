import { ulid } from "ulid";
import { CircuitBreakerOpenError } from "./errors.js";
import type {
  CircuitOpenedEvent,
  CircuitHalfOpenedEvent,
  CircuitClosedEvent,
} from "../types/events.js";

type BreakerStatus = "closed" | "open" | "half_open";

interface BreakerState {
  status: BreakerStatus;
  failureCount: number;
  nextAttempt: number;
}

export interface BreakerOptions {
  threshold: number;
  resetTimeout: number;
  enabled: boolean;
}

type EventEmitter = (event: CircuitOpenedEvent | CircuitHalfOpenedEvent | CircuitClosedEvent) => void;

export class CircuitBreaker {
  private states = new Map<string, BreakerState>();
  private readonly options: BreakerOptions;
  private readonly emit: EventEmitter;

  constructor(options: BreakerOptions, emit: EventEmitter) {
    this.options = options;
    this.emit = emit;
  }

  async call<T>(toolName: string, fn: () => Promise<T>, correlationId?: string): Promise<T> {
    if (!this.options.enabled) return fn();

    const state = this.getState(toolName);

    if (state.status === "open") {
      if (Date.now() >= state.nextAttempt) {
        this.transitionTo(toolName, "half_open", correlationId);
      } else {
        throw new CircuitBreakerOpenError(toolName);
      }
    }

    try {
      const result = await fn();
      this.recordSuccess(toolName, correlationId);
      return result;
    } catch (err) {
      this.recordFailure(toolName, err, correlationId);
      throw err;
    }
  }

  getState(toolName: string): BreakerState {
    if (!this.states.has(toolName)) {
      this.states.set(toolName, {
        status: "closed",
        failureCount: 0,
        nextAttempt: 0,
      });
    }
    return this.states.get(toolName)!;
  }

  reset(toolName: string): void {
    this.states.set(toolName, {
      status: "closed",
      failureCount: 0,
      nextAttempt: 0,
    });
  }

  private recordSuccess(toolName: string, correlationId?: string): void {
    const state = this.getState(toolName);
    if (state.status === "half_open") {
      state.failureCount = 0;
      this.transitionTo(toolName, "closed", correlationId);
    } else if (state.status === "closed") {
      state.failureCount = 0;
    }
  }

  private recordFailure(toolName: string, _err: unknown, correlationId?: string): void {
    const state = this.getState(toolName);
    state.failureCount++;

    if (state.status === "half_open" || state.failureCount >= this.options.threshold) {
      state.nextAttempt = Date.now() + this.options.resetTimeout;
      this.transitionTo(toolName, "open", correlationId);
    }
  }

  private transitionTo(toolName: string, status: BreakerStatus, correlationId?: string): void {
    const state = this.getState(toolName);
    state.status = status;
    const ts = Date.now();
    const base = {
      id: ulid(),
      version: 1 as const,
      timestamp: ts,
      ...(correlationId ? { correlationId } : {}),
    };

    switch (status) {
      case "open":
        this.emit({
          ...base,
          type: "circuit_opened",
          toolName,
          failureCount: state.failureCount,
          threshold: this.options.threshold,
        });
        break;
      case "half_open":
        this.emit({ ...base, type: "circuit_half_opened", toolName });
        break;
      case "closed":
        this.emit({ ...base, type: "circuit_closed", toolName });
        break;
    }
  }
}
