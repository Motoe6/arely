import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModelRegistry } from "@arelyos/engine/models/model-registry.js";
import { ModelAwareAdapter } from "@arelyos/engine/models/model-adapter.js";
import { ModelMetrics } from "@arelyos/engine/models/model-metrics.js";

vi.mock("@arelyos/engine/config/index.js", () => ({
  loadConfig: vi.fn(),
  getConfig: () => ({
    ARELY_API_KEY: "sk-test",
    ARELY_TOOL_MODE: "native",
  }),
}));

describe("ModelAwareAdapter", () => {
  let registry: ModelRegistry;
  let metrics: ModelMetrics;
  let adapter: ModelAwareAdapter;

  beforeEach(() => {
    vi.restoreAllMocks();
    registry = new ModelRegistry();
    metrics = new ModelMetrics();
    adapter = new ModelAwareAdapter(registry, "sk-test-key", metrics);
  });

  it("creates adapter with default model", () => {
    expect(adapter).toBeDefined();
  });

  it("returns model metrics instance", () => {
    expect(adapter.getModelMetrics()).toBe(metrics);
  });

  it("records metrics via ModelMetrics directly", () => {
    metrics.recordRequestStart("test-model", "req-1");
    metrics.recordRequestEnd("test-model", "req-1", true);
    const stats = metrics.getStats("test-model");
    expect(stats).not.toBeNull();
    expect(stats!.requests).toBe(1);
    expect(stats!.errorRate).toBe(0);
  });

  it("records error metrics", () => {
    metrics.recordRequestStart("test-model", "req-2");
    metrics.recordRequestEnd("test-model", "req-2", false, "timeout");
    const stats = metrics.getStats("test-model");
    expect(stats!.requests).toBe(1);
    expect(stats!.errorRate).toBe(1);
  });

  it("aggregates across models", () => {
    metrics.recordRequestStart("m1", "r1");
    metrics.recordRequestEnd("m1", "r1", true);
    metrics.recordRequestStart("m2", "r2");
    metrics.recordRequestEnd("m2", "r2", false, "err");
    const agg = metrics.getAggregated();
    expect(agg["m1"].requests).toBe(1);
    expect(agg["m2"].requests).toBe(1);
    expect(agg["m1"].errorRate).toBe(0);
    expect(agg["m2"].errorRate).toBe(1);
  });

  it("default model is used when no modelId provided", () => {
    const def = registry.getDefault();
    expect(def.id).toBe("deepseek-v4");
  });
});
