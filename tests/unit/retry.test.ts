import { describe, it, expect, vi, beforeEach } from "vitest";
import { withRetry } from "@arelyos/engine/tools/retry.js";
import { TimeoutError, CancelledError } from "@arelyos/engine/tools/errors.js";

function makeOpts(overrides?: Partial<{ maxAttempts: number; baseDelayMs: number; maxDelayMs: number; enabled: boolean }>) {
  return { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 1000, enabled: true, ...overrides };
}

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("succeeds on first attempt", async () => {
    const emit = vi.fn();
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, makeOpts(), emit);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  });

  it("succeeds on nth attempt after failures", async () => {
    const emit = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("try 1"))
      .mockRejectedValueOnce(new Error("try 2"))
      .mockResolvedValue("ok");
    const promise = withRetry(fn, makeOpts(), emit, { toolName: "search" });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "retry_attempt", attempt: 1, maxAttempts: 3, toolName: "search" }),
    );
  });

  it("does not retry on TimeoutError", async () => {
    const emit = vi.fn();
    const fn = vi.fn().mockRejectedValue(new TimeoutError(100));
    await expect(withRetry(fn, makeOpts(), emit)).rejects.toThrow(TimeoutError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  });

  it("does not retry on CancelledError", async () => {
    const emit = vi.fn();
    const fn = vi.fn().mockRejectedValue(new CancelledError());
    await expect(withRetry(fn, makeOpts(), emit)).rejects.toThrow(CancelledError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting max attempts", async () => {
    vi.useRealTimers();
    const emit = vi.fn();
    const fn = vi.fn().mockRejectedValue(new Error("persistent"));
    await expect(withRetry(fn, makeOpts({ maxAttempts: 2, baseDelayMs: 5 }), emit)).rejects.toThrow("persistent");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "retry_attempt", attempt: 1, maxAttempts: 2 }),
    );
  }, 10000);

  it("passes through when disabled", async () => {
    const emit = vi.fn();
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(withRetry(fn, makeOpts({ enabled: false }), emit)).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  });

  it("includes correlationId in retry event", async () => {
    const emit = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("try 1"))
      .mockResolvedValue("ok");
    const promise = withRetry(fn, makeOpts(), emit, { toolName: "search", correlationId: "corr-456" });
    await vi.runAllTimersAsync();
    await promise;
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "retry_attempt", correlationId: "corr-456" }),
    );
  });
});
