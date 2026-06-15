import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createSession } from "@arelyos/engine/persistence/session-store.js";
import { getSessionToolCalls } from "@arelyos/engine/persistence/tool-call-store.js";

const mockEmit = vi.fn();
let testSessionId = "";

vi.mock("@arelyos/engine/tools/websearch.js", () => ({
  performWebSearch: vi.fn().mockResolvedValue([
    { title: "Test Result", url: "https://example.com", content: "Test content" },
  ]),
}));

vi.mock("@arelyos/engine/tools/webfetch.js", () => ({
  performWebFetch: vi.fn().mockResolvedValue({
    url: "https://example.com",
    title: "Example",
    content: "# Hello",
  }),
}));

vi.mock("@arelyos/engine/config/index.js", () => ({
  getConfig: () => ({
    TOOL_TIMEOUT_MS: 5000,
    PERMISSION_TIMEOUT_MS: 5000,
    ARELY_PERMIT_WEBSEARCH: "allow",
    ARELY_PERMIT_WEBFETCH: "allow",
    CIRCUIT_BREAKER_ENABLED: false,
    CIRCUIT_BREAKER_THRESHOLD: 5,
    CIRCUIT_BREAKER_RESET_MS: 30000,
    RETRY_ENABLED: false,
    RETRY_MAX_ATTEMPTS: 3,
    RETRY_BASE_DELAY_MS: 1000,
    RETRY_MAX_DELAY_MS: 30000,
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
  const session = createSession({ query: "lifecycle test", model: "gpt-4o", toolMode: "native" });
  testSessionId = session.id;
});

afterEach(() => {
  cleanupTestDb();
});

describe("Tool lifecycle integration", () => {
  it("persists tool call to DB and emits SSE events through full lifecycle", async () => {
    const sse = createSseMock() as any;
    const gate = new PermissionGate(sse, testSessionId);
    const registry = createToolRegistry({
      sse,
      sessionId: testSessionId,
      gate,
      searchProvider: createProviderMock() as any,
    });

    const tool = registry.get("websearch")!;
    const result = await tool.execute({ query: "integration test" }, { sessionId: testSessionId });

    expect(result.content).toContain("Test Result");

    const calls = getSessionToolCalls(testSessionId);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe("websearch");
    expect(calls[0].status).toBe("completed");
    expect(calls[0].result).toContain("Test Result");

    const eventTypes = mockEmit.mock.calls.map((c: any[]) => c[1].type);
    expect(eventTypes).toContain("tool_call_pending");
    expect(eventTypes).toContain("tool_call_started");
    expect(eventTypes).toContain("tool_call_completed");

    const pendingEvent = mockEmit.mock.calls.find((c: any[]) => c[1].type === "tool_call_pending")![1];
    const startedEvent = mockEmit.mock.calls.find((c: any[]) => c[1].type === "tool_call_started")![1];
    const completedEvent = mockEmit.mock.calls.find((c: any[]) => c[1].type === "tool_call_completed")![1];

    const toolCallId = pendingEvent.toolCallId;
    expect(startedEvent.correlationId).toBe(toolCallId);
    expect(completedEvent.correlationId).toBe(toolCallId);
  });

  it("records failed status on execution error", async () => {
    const websearch = await import("@arelyos/engine/tools/websearch.js");
    (websearch.performWebSearch as any).mockRejectedValue(new Error("Network failure"));

    const sse = createSseMock() as any;
    const gate = new PermissionGate(sse, testSessionId);
    const registry = createToolRegistry({
      sse,
      sessionId: testSessionId,
      gate,
      searchProvider: createProviderMock() as any,
    });

    const tool = registry.get("websearch")!;
    await expect(tool.execute({ query: "fail" }, { sessionId: testSessionId })).rejects.toThrow("Network failure");

    const calls = getSessionToolCalls(testSessionId);
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe("failed");
    expect(calls[0].error).toContain("Network failure");

    const eventTypes = mockEmit.mock.calls.map((c: any[]) => c[1].type);
    expect(eventTypes).toContain("tool_call_failed");
  });
});
