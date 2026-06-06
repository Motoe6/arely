import { describe, it, expect, vi, beforeEach } from "vitest";
import { CircuitBreaker } from "../../src/tools/circuit-breaker.js";
import { CircuitBreakerOpenError } from "../../src/tools/errors.js";

function makeBreaker(opts?: Partial<{ threshold: number; resetTimeout: number; enabled: boolean }>) {
  const emit = vi.fn();
  const breaker = new CircuitBreaker(
    { threshold: 3, resetTimeout: 50_000, enabled: true, ...opts },
    emit,
  );
  return { breaker, emit };
}

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("starts closed and succeeds on first call", async () => {
    const { breaker } = makeBreaker();
    const result = await breaker.call("search", async () => "ok");
    expect(result).toBe("ok");
    expect(breaker.getState("search").status).toBe("closed");
  });

  it("opens after threshold failures are reached", async () => {
    const { breaker, emit } = makeBreaker({ threshold: 2 });
    const fn = async () => { throw new Error("fail"); };
    await expect(breaker.call("search", fn)).rejects.toThrow("fail");
    expect(breaker.getState("search").status).toBe("closed");
    expect(breaker.getState("search").failureCount).toBe(1);

    await expect(breaker.call("search", fn)).rejects.toThrow("fail");
    expect(breaker.getState("search").status).toBe("open");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "circuit_opened", toolName: "search", failureCount: 2, threshold: 2 }),
    );
  });

  it("fails fast when circuit is open", async () => {
    const { breaker } = makeBreaker({ threshold: 1, resetTimeout: 50_000 });
    await expect(breaker.call("search", async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    await expect(breaker.call("search", async () => "ok")).rejects.toThrow(CircuitBreakerOpenError);
  });

  it("transitions to half-open after reset timeout", async () => {
    const { breaker, emit } = makeBreaker({ threshold: 1, resetTimeout: 100 });
    await expect(breaker.call("search", async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    expect(breaker.getState("search").status).toBe("open");

    vi.advanceTimersByTime(100);
    const fn = vi.fn().mockRejectedValue(new Error("still failing"));
    await expect(breaker.call("search", fn)).rejects.toThrow("still failing");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "circuit_half_opened", toolName: "search" }),
    );
    expect(breaker.getState("search").status).toBe("open");
  });

  it("closes circuit after half-open probe succeeds", async () => {
    const { breaker, emit } = makeBreaker({ threshold: 1, resetTimeout: 100 });
    await expect(breaker.call("search", async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    vi.advanceTimersByTime(100);

    const result = await breaker.call("search", async () => "recovered");
    expect(result).toBe("recovered");
    expect(breaker.getState("search").status).toBe("closed");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "circuit_closed", toolName: "search" }),
    );
  });

  it("isolates state per tool", async () => {
    const { breaker } = makeBreaker({ threshold: 1 });
    await expect(breaker.call("search", async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    expect(breaker.getState("search").status).toBe("open");
    const result = await breaker.call("fetch", async () => "ok");
    expect(result).toBe("ok");
    expect(breaker.getState("fetch").status).toBe("closed");
  });

  it("passes through when disabled", async () => {
    const { breaker, emit } = makeBreaker({ enabled: false, threshold: 1 });
    await expect(breaker.call("search", async () => { throw new Error("err"); })).rejects.toThrow("err");
    const result = await breaker.call("search", async () => "ok");
    expect(result).toBe("ok");
    expect(emit).not.toHaveBeenCalled();
  });

  it("resets failure count on success in closed state", async () => {
    const { breaker } = makeBreaker({ threshold: 2 });
    await expect(breaker.call("search", async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    expect(breaker.getState("search").failureCount).toBe(1);
    await breaker.call("search", async () => "ok");
    expect(breaker.getState("search").failureCount).toBe(0);
  });

  it("includes correlationId in events when provided", async () => {
    const { breaker, emit } = makeBreaker({ threshold: 1 });
    await expect(breaker.call("search", async () => { throw new Error("fail"); }, "corr-123")).rejects.toThrow("fail");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "circuit_opened", correlationId: "corr-123" }),
    );
  });
});
