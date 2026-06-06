import { describe, it, expect, vi, beforeEach } from "vitest";
import { PipelineToolExecutor, PipelineToolError } from "../../src/agents/pipeline-tool-executor.js";
import { PipelineCircuitBreakerRegistry } from "../../src/agents/circuit-breaker-registry.js";

describe("Pipeline Circuit Breaker Integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("PipelineToolExecutor throws error when breaker is open", async () => {
    const breakerRegistry = new PipelineCircuitBreakerRegistry({
      threshold: 1,
      resetTimeout: 50_000,
      enabled: true,
    });

    const handlers = new Map<string, (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>();
    handlers.set("websearch", async () => { throw new Error("API error"); });

    const executor = new PipelineToolExecutor(handlers, { timeoutMs: 5000 }, breakerRegistry);

    await expect(executor.execute("websearch", { query: "test" })).rejects.toThrow("API error");

    await expect(executor.execute("websearch", { query: "test" })).rejects.toThrow(PipelineToolError);
    await expect(executor.execute("websearch", { query: "test" })).rejects.toThrow("circuit breaker");
  });

  it("breaker closes after half_open probe succeeds", async () => {
    const breakerRegistry = new PipelineCircuitBreakerRegistry({
      threshold: 1,
      resetTimeout: 100,
      enabled: true,
    });

    let callCount = 0;
    const handlers = new Map<string, (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>();
    handlers.set("websearch", async () => {
      callCount++;
      if (callCount === 1) throw new Error("API error");
      return "success";
    });

    const executor = new PipelineToolExecutor(handlers, { timeoutMs: 5000 }, breakerRegistry);

    await expect(executor.execute("websearch", { query: "test" })).rejects.toThrow("API error");
    expect(breakerRegistry.getState("websearch").state).toBe("open");

    vi.advanceTimersByTime(100);

    const result = await executor.execute("websearch", { query: "test" });
    expect(result.content).toBe("success");
    expect(breakerRegistry.getState("websearch").state).toBe("closed");
  });

  it("open breaker for tool A does not affect tool B", async () => {
    const breakerRegistry = new PipelineCircuitBreakerRegistry({
      threshold: 1,
      resetTimeout: 50_000,
      enabled: true,
    });

    const handlers = new Map<string, (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>();
    handlers.set("websearch", async () => { throw new Error("API error"); });
    handlers.set("webfetch", async () => "fetch ok");

    const executor = new PipelineToolExecutor(handlers, { timeoutMs: 5000 }, breakerRegistry);

    await expect(executor.execute("websearch", { query: "test" })).rejects.toThrow("API error");
    expect(breakerRegistry.getState("websearch").state).toBe("open");

    const result = await executor.execute("webfetch", { url: "https://example.com" });
    expect(result.content).toBe("fetch ok");
    expect(breakerRegistry.getState("webfetch").state).toBe("closed");
  });
});
