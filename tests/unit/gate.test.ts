import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockEmit = vi.fn();
const mockConfig = vi.fn();
const emittedEvents: string[] = [];
const requestIdsByType: Record<string, string> = {};

vi.mock("@opencode/engine/config/index.js", () => ({
  getConfig: () => mockConfig(),
}));

vi.mock("@opencode/engine/persistence/permission-store.js", () => ({
  createPermissionApproval: vi.fn(),
}));

vi.mock("@opencode/engine/persistence/audit-store.js", () => ({
  createAuditLog: vi.fn(),
}));

vi.mock("@opencode/engine/persistence/approval-cache-store.js", () => ({
  findMatchingApproval: vi.fn().mockReturnValue(undefined),
  setApproval: vi.fn(),
}));

import { PermissionGate } from "@opencode/engine/permissions/gate.js";

function createSseMock() {
  return {
    emit: (sessionId: string, event: any) => {
      emittedEvents.push(event.type);
      requestIdsByType[event.type] = event.requestId ?? event.toolCallId ?? "";
      mockEmit(sessionId, event);
    },
  };
}

function setConfigAsk(timeoutMs = 5000) {
  mockConfig.mockReturnValue({
    OPENCODE_PERMIT_WEBSEARCH: "ask",
    OPENCODE_PERMIT_WEBFETCH: "ask",
    PERMISSION_TIMEOUT_MS: timeoutMs,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  emittedEvents.length = 0;
  for (const key of Object.keys(requestIdsByType)) {
    delete requestIdsByType[key];
  }
  setConfigAsk();
});

describe("PermissionGate", () => {
  describe("mode=deny", () => {
    it("throws for denied tool", async () => {
      mockConfig.mockReturnValue({
        OPENCODE_PERMIT_WEBSEARCH: "deny",
        PERMISSION_TIMEOUT_MS: 5000,
      });
      const gate = new PermissionGate(createSseMock() as any, "session-1");
      await expect(gate.check("websearch", { query: "test" })).rejects.toThrow("Permission denied");
    });
  });

  describe("mode=allow", () => {
    it("returns true without prompting", async () => {
      mockConfig.mockReturnValue({
        OPENCODE_PERMIT_WEBSEARCH: "allow",
        PERMISSION_TIMEOUT_MS: 5000,
      });
      const gate = new PermissionGate(createSseMock() as any, "session-1");
      const result = await gate.check("websearch", { query: "test" });
      expect(result).toBe(true);
      expect(emittedEvents).not.toContain("permission_requested");
    });
  });

  describe("mode=ask with cache hit", () => {
    it("returns true when cache matches", async () => {
      const approvalCache = await import("@opencode/engine/persistence/approval-cache-store.js");
      (approvalCache.findMatchingApproval as any).mockReturnValue({
        id: "cache-1",
        granted: true,
        scope: "session",
      });
      const gate = new PermissionGate(createSseMock() as any, "session-1");
      const result = await gate.check("websearch", { query: "test" });
      expect(result).toBe(true);
      expect(emittedEvents).not.toContain("permission_requested");
      (approvalCache.findMatchingApproval as any).mockReset();
    });
  });

  describe("mode=ask with prompt and resolve", () => {
    it("resolves granted", async () => {
      setConfigAsk(5000);
      const gate = new PermissionGate(createSseMock() as any, "session-1");
      const checkPromise = gate.check("websearch", { query: "test" });

      expect(emittedEvents).toContain("permission_requested");
      const requestId = requestIdsByType["permission_requested"];
      expect(requestId).toBeTruthy();

      gate.resolve(requestId, true);
      const result = await checkPromise;
      expect(result).toBe(true);
    });

    it("resolves denied", async () => {
      setConfigAsk(5000);
      const gate = new PermissionGate(createSseMock() as any, "session-1");
      const checkPromise = gate.check("websearch", { query: "test" });

      expect(emittedEvents).toContain("permission_requested");
      const requestId = requestIdsByType["permission_requested"];
      expect(requestId).toBeTruthy();

      gate.resolve(requestId, false);
      const result = await checkPromise;
      expect(result).toBe(false);
    });

    it("resolve with invalid id is no-op", () => {
      const gate = new PermissionGate(createSseMock() as any, "session-1");
      expect(() => gate.resolve("nonexistent", true)).not.toThrow();
    });
  });

  describe("permission timeout", () => {
    it("auto-denies after timeout", async () => {
      setConfigAsk(10);
      const gate = new PermissionGate(createSseMock() as any, "session-1");
      const result = await gate.check("websearch", { query: "test" });
      expect(result).toBe(false);
    });
  });

  describe("unknown tool", () => {
    it("defaults to ask mode and times out", async () => {
      mockConfig.mockReturnValue({
        PERMISSION_TIMEOUT_MS: 10,
      });
      const gate = new PermissionGate(createSseMock() as any, "session-1");
      const result = await gate.check("unknown-tool", {});
      expect(result).toBe(false);
    });
  });
});
