import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createSession } from "@arelyos/engine/persistence/session-store.js";
import { getSessionToolCalls } from "@arelyos/engine/persistence/tool-call-store.js";
import { getSessionAuditLogs } from "@arelyos/engine/persistence/audit-store.js";

const mockEmit = vi.fn();
let testSessionId = "";

vi.mock("@arelyos/engine/tools/websearch.js", () => ({
  performWebSearch: vi.fn().mockResolvedValue([
    { title: "OK", url: "https://example.com", content: "Success" },
  ]),
}));

vi.mock("@arelyos/engine/tools/webfetch.js", () => ({
  performWebFetch: vi.fn().mockResolvedValue({
    url: "https://example.com", title: "Example", content: "# Hello",
  }),
}));

vi.mock("@arelyos/engine/config/index.js", () => ({
  getConfig: () => ({
    TOOL_TIMEOUT_MS: 5000,
    PERMISSION_TIMEOUT_MS: 5000,
    ARELY_PERMIT_WEBSEARCH: "allow",
    ARELY_PERMIT_WEBFETCH: "allow",
    CIRCUIT_BREAKER_ENABLED: true,
    CIRCUIT_BREAKER_THRESHOLD: 2,
    CIRCUIT_BREAKER_RESET_MS: 50000,
    RETRY_ENABLED: false,
    RETRY_MAX_ATTEMPTS: 3,
    RETRY_BASE_DELAY_MS: 10,
    RETRY_MAX_DELAY_MS: 1000,
    RATE_LIMIT_ENABLED: false,
    RATE_LIMIT_DEFAULT_MAX: 30,
    RATE_LIMIT_DEFAULT_WINDOW_MS: 60000,
  }),
}));

vi.mock("@arelyos/engine/persistence/approval-cache-store.js", () => ({
  findMatchingApproval: vi.fn(),
  setApproval: vi.fn(),
}));

import { createToolRegistry } from "@arelyos/engine/tools/registry.js";
import { PermissionGate } from "@arelyos/engine/permissions/gate.js";

function createSseMock() {
  return { emit: mockEmit };
}

function createProviderMock() {
  return { name: "exa", search: vi.fn() };
}

beforeEach(() => {
  initTestDb();
  vi.clearAllMocks();
  const session = createSession({ query: "resilience test", model: "gpt-4o", toolMode: "native" });
  testSessionId = session.id;
});

afterEach(() => {
  cleanupTestDb();
});

describe("Resilience pipeline integration", () => {
  it("circuit breaker opens after threshold failures", async () => {
    const websearch = await import("@arelyos/engine/tools/websearch.js");
    (websearch.performWebSearch as any).mockRejectedValue(new Error("Service down"));

    const sse = createSseMock() as any;
    const gate = new PermissionGate(sse, testSessionId);
    const registry = createToolRegistry({
      sse, sessionId: testSessionId, gate, searchProvider: createProviderMock() as any,
    });
    const tool = registry.get("websearch")!;

    await expect(tool.execute({ query: "fail" }, { sessionId: testSessionId })).rejects.toThrow("Service down");
    await expect(tool.execute({ query: "fail" }, { sessionId: testSessionId })).rejects.toThrow("Service down");
    await expect(tool.execute({ query: "fail" }, { sessionId: testSessionId })).rejects.toThrow("Circuit breaker is open");

    const eventTypes = mockEmit.mock.calls.map((c: any[]) => c[1].type);
    expect(eventTypes).toContain("circuit_opened");

    const calls = getSessionToolCalls(testSessionId);
    expect(calls.length).toBeLessThanOrEqual(3);
  });

  it("breaker isolation: websearch open does not affect webfetch", async () => {
    const websearch = await import("@arelyos/engine/tools/websearch.js");
    (websearch.performWebSearch as any).mockRejectedValue(new Error("Search down"));

    const sse = createSseMock() as any;
    const gate = new PermissionGate(sse, testSessionId);
    const registry = createToolRegistry({
      sse, sessionId: testSessionId, gate, searchProvider: createProviderMock() as any,
    });

    const searchTool = registry.get("websearch")!;
    const fetchTool = registry.get("webfetch")!;

    await expect(searchTool.execute({ query: "fail" }, { sessionId: testSessionId })).rejects.toThrow("Search down");
    await expect(searchTool.execute({ query: "fail" }, { sessionId: testSessionId })).rejects.toThrow("Search down");

    const result = await fetchTool.execute({ url: "https://example.com" }, { sessionId: testSessionId });
    expect(result.content).toContain("Example");
  });

});
