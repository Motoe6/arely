import { describe, it, expect } from "vitest";
import { createTracer, SpanStore } from "@opencode/engine/tracer.js";

describe("Tracer", () => {
  it("should start and end a span", () => {
    const store = new SpanStore();
    const tracer = createTracer(store);
    const span = tracer.startSpan("trace-1", "test.span");
    tracer.endSpan(span, { key: "value" });

    expect(span.startTime).toBeGreaterThan(0);
    expect(span.endTime).toBeGreaterThanOrEqual(span.startTime);
    expect(span.durationMs).toBeGreaterThanOrEqual(0);
    expect(span.status).toBe("ok");
    expect(span.tags).toEqual({ key: "value" });
  });

  it("should set status error when error string provided", () => {
    const store = new SpanStore();
    const tracer = createTracer(store);
    const span = tracer.startSpan("trace-1", "failing.span");
    tracer.endSpan(span, undefined, "something went wrong");

    expect(span.status).toBe("error");
    expect(span.error).toBe("something went wrong");
  });

  it("should get trace by traceId", () => {
    const store = new SpanStore();
    const tracer = createTracer(store);
    const span1 = tracer.startSpan("trace-1", "span.a");
    tracer.endSpan(span1);
    const span2 = tracer.startSpan("trace-1", "span.b", span1.spanId);
    tracer.endSpan(span2);

    const trace = tracer.getTrace("trace-1");
    expect(trace.traceId).toBe("trace-1");
    expect(trace.spans).toHaveLength(2);
  });

  it("should return empty spans for unknown traceId", () => {
    const tracer = createTracer();
    const trace = tracer.getTrace("nonexistent");
    expect(trace.traceId).toBe("nonexistent");
    expect(trace.spans).toEqual([]);
  });

  it("should list all trace IDs", () => {
    const store = new SpanStore();
    const tracer = createTracer(store);
    tracer.startSpan("trace-a", "span.1");
    tracer.startSpan("trace-b", "span.2");
    tracer.startSpan("trace-a", "span.3");

    const ids = tracer.getAllTraceIds();
    expect(ids.sort()).toEqual(["trace-a", "trace-b"]);
  });

  it("should sort spans by startTime", () => {
    const store = new SpanStore();
    const tracer = createTracer(store);
    const span1 = tracer.startSpan("t1", "first");
    const span2 = tracer.startSpan("t1", "second");
    const span3 = tracer.startSpan("t1", "third");

    const trace = tracer.getTrace("t1");
    expect(trace.spans.map(s => s.name)).toEqual(["first", "second", "third"]);
  });

  it("SpanStore.clear should remove all spans", () => {
    const store = new SpanStore();
    const tracer = createTracer(store);
    tracer.startSpan("t1", "s1");
    expect(store.getAllTraceIds()).toHaveLength(1);
    store.clear();
    expect(store.getAllTraceIds()).toHaveLength(0);
  });

  it("should create parent-child span relationship", () => {
    const store = new SpanStore();
    const tracer = createTracer(store);
    const parent = tracer.startSpan("t1", "parent");
    const child = tracer.startSpan("t1", "child", parent.spanId);

    expect(child.parentSpanId).toBe(parent.spanId);

    const trace = tracer.getTrace("t1");
    expect(trace.spans).toHaveLength(2);
  });
});
