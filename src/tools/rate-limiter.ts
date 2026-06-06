import { ulid } from "ulid";
import type { RateLimitExceededEvent } from "../types/events.js";

export class RateLimitExceededError extends Error {
  readonly toolName: string;
  readonly sessionId: string;
  constructor(toolName: string, sessionId: string, limit: number, windowMs: number) {
    super(`Rate limit exceeded for ${toolName}: ${limit} requests per ${windowMs}ms`);
    this.name = "RateLimitExceededError";
    this.toolName = toolName;
    this.sessionId = sessionId;
  }
}

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  enabled: boolean;
}

type EventEmitter = (event: RateLimitExceededEvent) => void;

interface WindowEntry {
  timestamps: number[];
}

export class RateLimiter {
  private windows = new Map<string, WindowEntry>();
  private readonly options: RateLimiterOptions;
  private readonly emit: EventEmitter;

  constructor(options: RateLimiterOptions, emit: EventEmitter) {
    this.options = options;
    this.emit = emit;
  }

  allow(toolName: string, sessionId: string): Promise<void> {
    if (!this.options.enabled) return Promise.resolve();

    const key = `${toolName}:${sessionId}`;
    const now = Date.now();
    const entry = this.windows.get(key) ?? { timestamps: [] };
    const cutoff = now - this.options.windowMs;

    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= this.options.maxRequests) {
      this.emit({
        id: ulid(),
        version: 1,
        timestamp: now,
        type: "rate_limit_exceeded",
        toolName,
        sessionId,
        limit: this.options.maxRequests,
        windowMs: this.options.windowMs,
      });
      return Promise.reject(new RateLimitExceededError(toolName, sessionId, this.options.maxRequests, this.options.windowMs));
    }

    entry.timestamps.push(now);
    this.windows.set(key, entry);
    return Promise.resolve();
  }

  reset(toolName: string, sessionId: string): void {
    this.windows.delete(`${toolName}:${sessionId}`);
  }

  resetAll(): void {
    this.windows.clear();
  }
}
