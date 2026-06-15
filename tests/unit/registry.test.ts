import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEmit = vi.fn();
const mockGateCheck = vi.fn();
const mockCreateToolCall = vi.fn();
const mockUpdateToolCallStatus = vi.fn();
const mockGetConfig = vi.fn();
const mockPerformWebSearch = vi.fn();
const mockPerformWebFetch = vi.fn();

vi.mock("@arelyos/engine/config/index.js", () => ({
  getConfig: () => mockGetConfig(),
}));

vi.mock("@arelyos/engine/persistence/tool-call-store.js", () => ({
  createToolCall: (...args: unknown[]) => mockCreateToolCall(...args),
  updateToolCallStatus: (...args: unknown[]) => mockUpdateToolCallStatus(...args),
}));

vi.mock("@arelyos/engine/tools/websearch.js", () => ({
  performWebSearch: (...args: unknown[]) => mockPerformWebSearch(...args),
}));

vi.mock("@arelyos/engine/tools/webfetch.js", () => ({
  performWebFetch: (...args: unknown[]) => mockPerformWebFetch(...args),
}));

import { createToolRegistry, TimeoutError, CancelledError } from "@arelyos/engine/tools/registry.js";

function createSseMock() {
  return { emit: mockEmit };
}

function createGateMock() {
  return { check: mockGateCheck };
}

function createProviderMock() {
  return { name: "exa", search: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockReturnValue({
    TOOL_TIMEOUT_MS: 5000,
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
  });
  mockGateCheck.mockResolvedValue(true);
  mockCreateToolCall.mockReturnValue({ id: "tc-1", sessionId: "s1", toolName: "websearch", args: {}, status: "pending", createdAt: new Date().toISOString() });
});

describe("ToolRegistry", () => {
  describe("websearch", () => {
    it("completes successfully with results", async () => {
      mockPerformWebSearch.mockResolvedValue([{ title: "Result 1", url: "https://example.com", content: "Content 1" }]);
      const registry = createToolRegistry({
        sse: createSseMock() as any,
        sessionId: "s1",
        gate: createGateMock() as any,
        searchProvider: createProviderMock() as any,
      });
      const tool = registry.get("websearch")!;
      const result = await tool.execute({ query: "test" }, { sessionId: "s1" });
      expect(result.content).toContain("Result 1");
      expect(mockCreateToolCall).toHaveBeenCalled();
      expect(mockUpdateToolCallStatus).toHaveBeenCalledWith("tc-1", "completed", expect.anything());
    });

    it("returns declined when gate denies", async () => {
      mockGateCheck.mockResolvedValue(false);
      const registry = createToolRegistry({
        sse: createSseMock() as any,
        sessionId: "s1",
        gate: createGateMock() as any,
        searchProvider: createProviderMock() as any,
      });
      const tool = registry.get("websearch")!;
      const result = await tool.execute({ query: "test" }, { sessionId: "s1" });
      expect(result.content).toContain("declined");
      expect(mockCreateToolCall).not.toHaveBeenCalled();
    });

    it("emits tool_call_failed on execution error", async () => {
      mockPerformWebSearch.mockRejectedValue(new Error("Search API error"));
      const registry = createToolRegistry({
        sse: createSseMock() as any,
        sessionId: "s1",
        gate: createGateMock() as any,
        searchProvider: createProviderMock() as any,
      });
      const tool = registry.get("websearch")!;
      await expect(tool.execute({ query: "test" }, { sessionId: "s1" })).rejects.toThrow("Search API error");
      expect(mockUpdateToolCallStatus).toHaveBeenCalledWith("tc-1", "failed", expect.anything());
    });
  });

  describe("webfetch", () => {
    it("completes successfully", async () => {
      mockPerformWebFetch.mockResolvedValue({ url: "https://example.com", title: "Example", content: "# Hello" });
      const registry = createToolRegistry({
        sse: createSseMock() as any,
        sessionId: "s1",
        gate: createGateMock() as any,
        searchProvider: createProviderMock() as any,
      });
      const tool = registry.get("webfetch")!;
      const result = await tool.execute({ url: "https://example.com" }, { sessionId: "s1" });
      expect(result.content).toContain("Example");
    });

    it("emits tool_call_failed on fetch error", async () => {
      mockPerformWebFetch.mockRejectedValue(new Error("Fetch error"));
      const registry = createToolRegistry({
        sse: createSseMock() as any,
        sessionId: "s1",
        gate: createGateMock() as any,
        searchProvider: createProviderMock() as any,
      });
      const tool = registry.get("webfetch")!;
      await expect(tool.execute({ url: "https://example.com" }, { sessionId: "s1" })).rejects.toThrow("Fetch error");
    });
  });

  describe("TimeoutError and CancelledError", () => {
    it("TimeoutError has correct name", () => {
      const err = new TimeoutError(1000);
      expect(err.name).toBe("TimeoutError");
      expect(err.message).toContain("1000");
    });

    it("CancelledError has correct name", () => {
      const err = new CancelledError();
      expect(err.name).toBe("CancelledError");
    });
  });
});
