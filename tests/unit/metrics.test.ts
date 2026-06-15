import { describe, it, expect, beforeEach } from "vitest";

describe("Metrics", () => {
  let metrics: import("@arelyos/engine/metrics.js").MetricsInstance;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("@arelyos/engine/metrics.js");
    metrics = mod.metrics;
  });

  it("should increment a counter", () => {
    metrics.increment("requests");
    const snap = metrics.snapshot();
    expect(snap.counters).toHaveProperty('requests{}');
    expect(snap.counters['requests{}']).toBe(1);
  });

  it("should increment with labels", () => {
    metrics.increment("requests", { method: "GET" });
    const snap = metrics.snapshot();
    expect(snap.counters['requests{method="GET"}']).toBe(1);
  });

  it("should observe duration in correct histogram bucket", () => {
    metrics.observeDuration("latency", { endpoint: "/test" }, 30);
    const snap = metrics.snapshot();
    const hist = snap.histograms['latency{endpoint="/test"}'];
    expect(hist.count).toBe(1);
    expect(hist.sum).toBe(30);
    expect(hist.buckets["50"]).toBe(1);
    expect(hist.buckets["25"]).toBe(0);
  });

  it("should place durations in +Inf bucket when above max", () => {
    metrics.observeDuration("latency", {}, 6000);
    const snap = metrics.snapshot();
    const hist = snap.histograms['latency{}'];
    expect(hist.buckets["Infinity"]).toBe(1);
    expect(hist.buckets["5000"]).toBe(0);
  });

  it("should accumulate multiple observations", () => {
    metrics.observeDuration("latency", { api: "v1" }, 10);
    metrics.observeDuration("latency", { api: "v1" }, 20);
    const snap = metrics.snapshot();
    const hist = snap.histograms['latency{api="v1"}'];
    expect(hist.count).toBe(2);
    expect(hist.sum).toBe(30);
  });

  it("should set a gauge", () => {
    metrics.setGauge("connections", { pool: "main" }, 42);
    const snap = metrics.snapshot();
    expect(snap.gauges['connections{pool="main"}']).toBe(42);
  });

  it("should overwrite gauge on subsequent set", () => {
    metrics.setGauge("connections", {}, 1);
    metrics.setGauge("connections", {}, 2);
    const snap = metrics.snapshot();
    expect(snap.gauges['connections{}']).toBe(2);
  });

  it("should export Prometheus format for counters", () => {
    metrics.increment("http_requests", { method: "GET" });
    const output = metrics.prometheusExport();
    expect(output).toContain('# TYPE arely_http_requests counter');
    expect(output).toContain('arely_http_requests{method="GET"} 1');
  });

  it("should export Prometheus format for histograms", () => {
    metrics.observeDuration("http_duration", { route: "/health" }, 50);
    const output = metrics.prometheusExport();
    expect(output).toContain('# TYPE arely_http_duration histogram');
    expect(output).toContain('arely_http_duration_bucket{route="/health"}{le="1"}');
    expect(output).toContain('arely_http_duration_sum{route="/health"}');
    expect(output).toContain('arely_http_duration_count{route="/health"}');
  });

  it("should export Prometheus format for gauges", () => {
    metrics.setGauge("active_requests", {}, 5);
    const output = metrics.prometheusExport();
    expect(output).toContain('# TYPE arely_active_requests gauge');
    expect(output).toContain('arely_active_requests{} 5');
  });
});
