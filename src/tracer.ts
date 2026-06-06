import { ulid } from "ulid";

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

  clear(): void {
    this.spans.clear();
  }
}

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
  };
}

export const tracer = createTracer();
