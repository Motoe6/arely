import { describe, it, expect } from "vitest";
import { HealthRegistry } from "../../src/health.js";

describe("HealthRegistry", () => {
  it("should return ok=true when all checks pass", () => {
    const registry = new HealthRegistry();
    registry.registerCheck("db", () => ({ ok: true, latencyMs: 2 }));
    registry.registerCheck("sse", () => ({ ok: true }));
    const status = registry.getStatus();
    expect(status.ok).toBe(true);
    expect(status.checks).toHaveLength(2);
  });

  it("should return ok=false when any check fails", () => {
    const registry = new HealthRegistry();
    registry.registerCheck("db", () => ({ ok: true }));
    registry.registerCheck("llm", () => ({ ok: false, error: "LLM not reachable" }));
    const status = registry.getStatus();
    expect(status.ok).toBe(false);
  });

  it("should capture latency from check function", () => {
    const registry = new HealthRegistry();
    registry.registerCheck("db", () => ({ ok: true, latencyMs: 5 }));
    const status = registry.getStatus();
    expect(status.checks[0].latencyMs).toBe(5);
  });

  it("should capture error message when check returns error", () => {
    const registry = new HealthRegistry();
    registry.registerCheck("db", () => ({ ok: false, error: "connection refused" }));
    const status = registry.getStatus();
    expect(status.checks[0].error).toBe("connection refused");
  });

  it("should handle check that throws (defensive)", () => {
    const registry = new HealthRegistry();
    registry.registerCheck("unstable", () => {
      throw new Error("unexpected crash");
    });
    const status = registry.getStatus();
    expect(status.ok).toBe(false);
    expect(status.checks[0].error).toBe("unexpected crash");
    expect(status.checks[0].ok).toBe(false);
  });

  it("should handle check that throws non-Error", () => {
    const registry = new HealthRegistry();
    registry.registerCheck("bad", () => {
      throw "string explosion";
    });
    const status = registry.getStatus();
    expect(status.ok).toBe(false);
    expect(status.checks[0].error).toBe("string explosion");
  });

  it("should return empty checks list when no checks registered", () => {
    const registry = new HealthRegistry();
    const status = registry.getStatus();
    expect(status.ok).toBe(true);
    expect(status.checks).toHaveLength(0);
  });

  it("should allow overwriting a check by name", () => {
    const registry = new HealthRegistry();
    registry.registerCheck("db", () => ({ ok: false, error: "first" }));
    registry.registerCheck("db", () => ({ ok: true }));
    const status = registry.getStatus();
    expect(status.ok).toBe(true);
    expect(status.checks).toHaveLength(1);
  });
});
