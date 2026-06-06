import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Logger", () => {
  it("should write JSON output to console.log for info", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { logger: testLogger } = await import("@opencode/engine/logger.js");
    testLogger.info("test-mod", "hello world");
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0];
    const parsed = JSON.parse(call);
    expect(parsed.level).toBe("info");
    expect(parsed.module).toBe("test-mod");
    expect(parsed.message).toBe("hello world");
    expect(parsed.timestamp).toBeTypeOf("string");
    spy.mockRestore();
  });

  it("should include correlationId in output when provided", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { logger: testLogger } = await import("@opencode/engine/logger.js");
    testLogger.info("test", "msg", { correlationId: "abc-123" });
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.correlationId).toBe("abc-123");
    spy.mockRestore();
  });

  it("should serialize Error objects in structured format", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { logger: testLogger } = await import("@opencode/engine/logger.js");
    const err = new Error("boom");
    testLogger.error("test", "error happened", { error: err });
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.error.message).toBe("boom");
    expect(parsed.error.name).toBe("Error");
    expect(parsed.error.stack).toBeTypeOf("string");
    spy.mockRestore();
  });

  it("should serialize non-Error errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { logger: testLogger } = await import("@opencode/engine/logger.js");
    testLogger.error("test", "string error", { error: "something broke" });
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.error.message).toBe("something broke");
    spy.mockRestore();
  });

  it("should create child logger that merges extra fields", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { logger: testLogger } = await import("@opencode/engine/logger.js");
    const child = testLogger.child({ sessionId: "sess-1" });
    child.info("child-mod", "child message");
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.module).toBe("child-mod");
    expect(parsed.sessionId).toBe("sess-1");
    spy.mockRestore();
  });

  it("should support structured object-first signature", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { logger: testLogger } = await import("@opencode/engine/logger.js");
    testLogger.info({ module: "struct", message: "obj call", event: "test_event" });
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.module).toBe("test_event");
    expect(parsed.message).toBe("obj call");
    expect(parsed.event).toBe("test_event");
    spy.mockRestore();
  });

  it("should write warn/error to console.error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { logger: testLogger } = await import("@opencode/engine/logger.js");
    testLogger.warn("test", "warning");
    testLogger.error("test", "error");
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
