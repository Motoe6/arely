import { getConfig } from "./config/index.js";
import { getRequestContext } from "./transport/request-context.js";
import { ulid } from "ulid";

const RUNTIME_ID = ulid();

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  correlationId?: string;
  traceId?: string;
  sessionId?: string;
  toolCallId?: string;
  error?: unknown;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

function formatError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(err.cause ? { cause: String(err.cause) } : {}),
    };
  }
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    return { message: String(obj.message ?? obj.error ?? err), ...obj };
  }
  return { message: String(err) };
}

function getEffectiveLogLevel(): LogLevel {
  try {
    return getConfig().LOG_LEVEL;
  } catch {
    return "info";
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[getEffectiveLogLevel()];
}

function resolveCorrelationId(): string {
  const ctx = getRequestContext();
  return ctx?.requestId ?? RUNTIME_ID;
}

export type LoggerFn = {
  (module: string, message: string, extra?: Partial<LogEntry>): void;
  (entry: { module: string; message: string; event?: string; correlationId?: string; sessionId?: string; error?: unknown; metadata?: Record<string, unknown> } & Record<string, unknown>): void;
};

class Logger {
  private format: "json" | "text";
  private baseExtra: Partial<LogEntry>;

  constructor(baseExtra: Partial<LogEntry> = {}) {
    this.baseExtra = baseExtra;
    try {
      this.format = getConfig().LOG_FORMAT;
    } catch {
      this.format = "json";
    }
  }

  child(extra: Partial<LogEntry>): Logger {
    return new Logger({ ...this.baseExtra, ...extra });
  }

  debug(moduleOrEntry: string | Record<string, unknown>, message?: string, extra?: Partial<LogEntry>): void {
    this.write("debug", moduleOrEntry, message, extra);
  }

  info(moduleOrEntry: string | Record<string, unknown>, message?: string, extra?: Partial<LogEntry>): void {
    this.write("info", moduleOrEntry, message, extra);
  }

  warn(moduleOrEntry: string | Record<string, unknown>, message?: string, extra?: Partial<LogEntry>): void {
    this.write("warn", moduleOrEntry, message, extra);
  }

  error(moduleOrEntry: string | Record<string, unknown>, message?: string, extra?: Partial<LogEntry>): void {
    this.write("error", moduleOrEntry, message, extra);
  }

  private write(level: LogLevel, moduleOrEntry: string | Record<string, unknown>, message?: string, extra?: Partial<LogEntry>): void {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: "",
      message: "",
      ...this.baseExtra,
    };

    if (typeof moduleOrEntry === "string") {
      entry.module = moduleOrEntry;
      entry.message = message ?? "";
      if (extra) Object.assign(entry, extra);
    } else {
      Object.assign(entry, moduleOrEntry);
      if (entry.event) entry.module = entry.event as string;
    }

    if (!entry.correlationId) {
      entry.correlationId = resolveCorrelationId();
    }

    if (!entry.traceId) {
      const ctx = getRequestContext();
      if (ctx?.traceId) entry.traceId = ctx.traceId;
    }

    if (entry.error !== undefined) {
      entry.error = formatError(entry.error);
    }

    const method = level === "error" || level === "warn" ? console.error : level === "debug" ? console.debug : console.log;

    if (this.format === "text") {
      const parts = [`[${level.toUpperCase()}]`, `[${entry.module}]`, entry.message];
      if (entry.correlationId) parts.push(`[${entry.correlationId}]`);
      if (entry.sessionId) parts.push(`session=${entry.sessionId}`);
      if (entry.metadata) {
        for (const [k, v] of Object.entries(entry.metadata)) {
          parts.push(`${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
        }
      }
      if (entry.error) {
        const e = entry.error as Record<string, unknown>;
        parts.push(`error=${e.message ?? JSON.stringify(e)}`);
      }
      method(parts.join(" "));
    } else {
      method(JSON.stringify(entry));
    }
  }
}

export const logger = new Logger();
