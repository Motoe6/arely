import { describe, it, expect, vi, beforeEach } from "vitest";
import { PipelineCircuitBreakerRegistry } from "@arelyos/engine/agents/circuit-breaker-registry.js";
import { CircuitBreakerOpenError } from "@arelyos/engine/tools/errors.js";

function makeRegistry(opts?: Partial<{ threshold: number; resetTimeout: number; enabled: boolean }>) {
  return new PipelineCircuitBreakerRegistry({
    threshold: 3,
    resetTimeout: 50_000,
    enabled: true,
    ...opts,
  });
}

describe("PipelineCircuitBreakerRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("starts closed and first call succeeds", async () => {
    const registry = makeRegistry();
    const result = await registry.execute("search", null, async () => "ok");
    expect(result).toBe("ok");
    expect(registry.getState("search").state).toBe("closed");
  });

  it("opens after threshold failures are reached", async () => {
    const registry = makeRegistry({ threshold: 2 });
    const fn = async () => { throw new Error("fail"); };
    await expect(registry.execute("search", null, fn)).rejects.toThrow("fail");
    expect(registry.getState("search").state).toBe("closed");
    expect(registry.getState("search").failures).toBe(1);

    await expect(registry.execute("search", null, fn)).rejects.toThrow("fail");
    expect(registry.getState("search").state).toBe("open");
  });

  it("fails fast with CircuitBreakerOpenError when circuit is open", async () => {
    const registry = makeRegistry({ threshold: 1, resetTimeout: 50_000 });
    await expect(registry.execute("search", null, async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    await expect(registry.execute("search", null, async () => "ok")).rejects.toThrow(CircuitBreakerOpenError);
  });

  it("transitions to half_open after reset timeout", async () => {
    const registry = makeRegistry({ threshold: 1, resetTimeout: 100 });
    await expect(registry.execute("search", null, async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    expect(registry.getState("search").state).toBe("open");

    vi.advanceTimersByTime(100);
    await expect(registry.execute("search", null, async () => { throw new Error("still failing"); })).rejects.toThrow("still failing");
    expect(registry.getState("search").state).toBe("open");
  });

  it("closes circuit after half_open probe succeeds", async () => {
    const registry = makeRegistry({ threshold: 1, resetTimeout: 100 });
    await expect(registry.execute("search", null, async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    vi.advanceTimersByTime(100);

    const result = await registry.execute("search", null, async () => "recovered");
    expect(result).toBe("recovered");
    expect(registry.getState("search").state).toBe("closed");
  });

  it("re-opens on failure in half_open", async () => {
    const registry = makeRegistry({ threshold: 1, resetTimeout: 100 });
    await expect(registry.execute("search", null, async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    vi.advanceTimersByTime(100);

    await expect(registry.execute("search", null, async () => { throw new Error("still fail"); })).rejects.toThrow("still fail");
    expect(registry.getState("search").state).toBe("open");
  });

  it("isolates state per tool", async () => {
    const registry = makeRegistry({ threshold: 1 });
    await expect(registry.execute("search", null, async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    expect(registry.getState("search").state).toBe("open");

    const result = await registry.execute("fetch", null, async () => "ok");
    expect(result).toBe("ok");
    expect(registry.getState("fetch").state).toBe("closed");
  });

  it("passes through when disabled", async () => {
    const registry = makeRegistry({ enabled: false, threshold: 1 });
    await expect(registry.execute("search", null, async () => { throw new Error("err"); })).rejects.toThrow("err");
    const result = await registry.execute("search", null, async () => "ok");
    expect(result).toBe("ok");
  });

  it("getState returns lastErrorKind and timestamps", async () => {
    const registry = makeRegistry({ threshold: 1 });
    await expect(registry.execute("search", "timeout", async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    const state = registry.getState("search");
    expect(state.lastErrorKind).toBe("timeout");
    expect(state.lastFailureAt).not.toBeNull();
    expect(state.openedAt).not.toBeNull();
  });

  it("reset clears state", async () => {
    const registry = makeRegistry({ threshold: 1 });
    await expect(registry.execute("search", null, async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    expect(registry.getState("search").state).toBe("open");

    registry.reset("search");
    const state = registry.getState("search");
    expect(state.state).toBe("closed");
    expect(state.failures).toBe(0);
    expect(state.lastErrorKind).toBeNull();
  });

  it("resetAll clears all state", async () => {
    const registry = makeRegistry({ threshold: 1 });
    await expect(registry.execute("search", null, async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    await expect(registry.execute("fetch", null, async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    expect(registry.getState("search").state).toBe("open");
    expect(registry.getState("fetch").state).toBe("open");

    const reset = registry.resetAll();
    expect(reset).toContain("search");
    expect(reset).toContain("fetch");
    expect(registry.getState("search").state).toBe("closed");
    expect(registry.getState("fetch").state).toBe("closed");
  });

  it("getAllStates returns all tracked tools", async () => {
    const registry = makeRegistry({ threshold: 1 });
    await expect(registry.execute("search", null, async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    await expect(registry.execute("fetch", null, async () => { throw new Error("fail"); })).rejects.toThrow("fail");

    const all = registry.getAllStates();
    expect(all).toHaveLength(2);
    const names = all.map((s) => s.toolName).sort();
    expect(names).toEqual(["fetch", "search"]);
  });
});
