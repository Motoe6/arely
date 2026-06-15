import { describe, it, expect, vi, beforeEach } from "vitest";
import { RateLimiter, RateLimitExceededError } from "@arelyos/engine/tools/rate-limiter.js";

function makeLimiter(opts?: Partial<{ maxRequests: number; windowMs: number; enabled: boolean }>) {
  const emit = vi.fn();
  const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000, enabled: true, ...opts }, emit);
  return { limiter, emit };
}

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("allows requests under the limit", async () => {
    const { limiter, emit } = makeLimiter();
    await limiter.allow("search", "session-1");
    await limiter.allow("search", "session-1");
    await limiter.allow("search", "session-1");
    expect(emit).not.toHaveBeenCalled();
  });

  it("blocks requests over the limit", async () => {
    const { limiter, emit } = makeLimiter({ maxRequests: 2 });
    await limiter.allow("search", "session-1");
    await limiter.allow("search", "session-1");
    await expect(limiter.allow("search", "session-1")).rejects.toThrow(RateLimitExceededError);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "rate_limit_exceeded", toolName: "search", sessionId: "session-1" }),
    );
  });

  it("resets window after time passes", async () => {
    const { limiter } = makeLimiter({ maxRequests: 1, windowMs: 100 });
    await limiter.allow("search", "session-1");
    vi.advanceTimersByTime(100);
    await expect(limiter.allow("search", "session-1")).resolves.toBeUndefined();
  });

  it("isolates per tool", async () => {
    const { limiter } = makeLimiter({ maxRequests: 1 });
    await limiter.allow("search", "session-1");
    await expect(limiter.allow("fetch", "session-1")).resolves.toBeUndefined();
  });

  it("isolates per session", async () => {
    const { limiter } = makeLimiter({ maxRequests: 1 });
    await limiter.allow("search", "session-1");
    await expect(limiter.allow("search", "session-2")).resolves.toBeUndefined();
  });

  it("passes through when disabled", async () => {
    const { limiter, emit } = makeLimiter({ enabled: false, maxRequests: 1 });
    await limiter.allow("search", "session-1");
    await limiter.allow("search", "session-1");
    expect(emit).not.toHaveBeenCalled();
  });

  it("resets state for a given tool and session", async () => {
    const { limiter } = makeLimiter({ maxRequests: 1 });
    await limiter.allow("search", "session-1");
    await expect(limiter.allow("search", "session-1")).rejects.toThrow(RateLimitExceededError);
    limiter.reset("search", "session-1");
    await expect(limiter.allow("search", "session-1")).resolves.toBeUndefined();
  });
});
