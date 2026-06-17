import { ulid } from "ulid";
import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

export type SpanStatus = "ok" | "error";

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status?: SpanStatus;
  error?: string;
  tags?: Record<string, unknown>;
}

export interface TraceResult {
  traceId: string;
  spans: Span[];
}

export interface Tracer {
  startSpan(traceId: string, name: string, parentSpanId?: string): Span;
  endSpan(span: Span, tags?: Record<string, unknown>, error?: string): void;
  getTrace(traceId: string): TraceResult;
  getAllTraceIds(): string[];
  queryTraces(query: TraceQuery): TraceResult[];
  getRecentTraces(limit?: number): TraceResult[];
}

export interface TraceQuery {
  sessionId?: string;
  swarmId?: string;
  role?: string;
  provider?: string;
  since?: number;
  until?: number;
  status?: SpanStatus;
  limit?: number;
}

export class SpanStore {
  private spans = new Map<string, Span>();

  add(span: Span): void {
    this.spans.set(span.spanId, span);
  }

  getByTraceId(traceId: string): Span[] {
    const result: Span[] = [];
    for (const span of this.spans.values()) {
      if (span.traceId === traceId) result.push(span);
    }
    result.sort((a, b) => a.startTime - b.startTime);
    return result;
  }

  getAllTraceIds(): string[] {
    const ids = new Set<string>();
    for (const span of this.spans.values()) {
      ids.add(span.traceId);
    }
    return [...ids];
  }

  getAllSpans(): Span[] {
    return [...this.spans.values()].sort((a, b) => a.startTime - b.startTime);
  }

  query(query: TraceQuery): Span[] {
    const all = this.getAllSpans();
    return all.filter((s) => {
      if (query.sessionId) {
        const tags = s.tags ?? {};
        if (tags.sessionId !== query.sessionId && !s.traceId.includes(query.sessionId)) return false;
      }
      if (query.swarmId && !s.traceId.includes(query.swarmId) && (s.tags?.swarmId !== query.swarmId)) return false;
      if (query.role && s.tags?.role !== query.role) return false;
      if (query.provider && s.tags?.provider !== query.provider) return false;
      if (query.since && s.startTime < query.since) return false;
      if (query.until && s.startTime > query.until) return false;
      if (query.status && s.status !== query.status) return false;
      return true;
    }).slice(0, query.limit ?? 100);
  }

  clear(): void {
    this.spans.clear();
  }
}

// ── OpenTelemetry initialization (opt-in via env) ──

let _otelInitialized = false;

export function initOtel(config: {
  serviceName: string;
  endpoint: string;
  samplingRatio: number;
}): void {
  if (_otelInitialized) return;
  _otelInitialized = true;

  const exporter = new OTLPTraceExporter({
    url: config.endpoint,
  });

  const provider = new BasicTracerProvider({
    resource: new Resource({
      "service.name": config.serviceName,
    }),
  });

  provider.addSpanProcessor(
    new BatchSpanProcessor(exporter, {
      maxExportBatchSize: 512,
      scheduledDelayMillis: 5000,
    }),
  );

  provider.register();
}

export function isOtelEnabled(): boolean {
  return _otelInitialized;
}

// ── W3C Trace Context helpers ──

export function parseTraceparent(tp: string): { traceId: string; spanId: string; flags: string } | null {
  const parts = tp.split("-");
  if (parts.length !== 4 || parts[0] !== "00") return null;
  if (parts[1].length !== 32 || parts[2].length !== 16) return null;
  return { traceId: parts[1], spanId: parts[2], flags: parts[3] };
}

export function formatTraceparent(traceId: string, spanId: string, flags = "01"): string {
  return `00-${traceId}-${spanId}-${flags}`;
}

function randomHex(len: number): string {
  const bytes = new Uint8Array(len / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newOtelTraceId(): string {
  return randomHex(32);
}

export function newOtelSpanId(): string {
  return randomHex(16);
}

// ── In-memory tracer (backward compatible) ──

export function createTracer(store?: SpanStore): Tracer {
  const spanStore = store ?? new SpanStore();

  return {
    startSpan(traceId: string, name: string, parentSpanId?: string): Span {
      const span: Span = {
        traceId,
        spanId: ulid(),
        parentSpanId,
        name,
        startTime: Date.now(),
      };
      spanStore.add(span);
      return span;
    },

    endSpan(span: Span, tags?: Record<string, unknown>, error?: string): void {
      span.endTime = Date.now();
      span.durationMs = span.endTime - span.startTime;
      span.status = error ? "error" : "ok";
      if (error) span.error = error;
      if (tags) span.tags = tags;
    },

    getTrace(traceId: string): TraceResult {
      return { traceId, spans: spanStore.getByTraceId(traceId) };
    },

    getAllTraceIds(): string[] {
      return spanStore.getAllTraceIds();
    },

    queryTraces(query: TraceQuery): TraceResult[] {
      const spans = spanStore.query(query);
      const byTrace = new Map<string, Span[]>();
      for (const s of spans) {
        const list = byTrace.get(s.traceId);
        if (list) list.push(s);
        else byTrace.set(s.traceId, [s]);
      }
      return [...byTrace.entries()].map(([traceId, spanList]) => ({
        traceId,
        spans: spanList.sort((a, b) => a.startTime - b.startTime),
      }));
    },

    getRecentTraces(limit = 20): TraceResult[] {
      const ids = spanStore.getAllTraceIds().slice(-limit);
      return ids.map((id) => ({ traceId: id, spans: spanStore.getByTraceId(id) }));
    },
  };
}

export const tracer = createTracer();
