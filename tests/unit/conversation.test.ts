import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import type { Message } from "../../src/types.js";

const mockMessages: Message[] = [];
let mockSequence = 0;

vi.mock("../../src/persistence/message-store.js", () => ({
  getSessionMessages: vi.fn(() => mockMessages),
}));

import { loadConfig } from "../../src/config/index.js";
import {
  loadConversation,
  injectToolResult,
  injectSystemPrompt,
  hasReachedTokenLimit,
} from "../../src/llm/conversation.js";

describe("conversation", () => {
  beforeAll(() => {
    process.env.OPENCODE_API_KEY = "test-key";
    loadConfig();
  });

  beforeEach(() => {
    mockMessages.length = 0;
    mockSequence = 0;
  });

  describe("loadConversation", () => {
    it("should convert persisted Message[] to SessionMessage[]", () => {
      mockMessages.push(
        { id: "1", sessionId: "s1", role: "system", content: "You are helpful", sequence: 0, createdAt: "2026-01-01T00:00:00Z" },
        { id: "2", sessionId: "s1", role: "user", content: "Hello", sequence: 1, createdAt: "2026-01-01T00:00:01Z" },
      );

      const result = loadConversation("s1");
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("system");
      expect(result[0].content).toBe("You are helpful");
      expect(result[1].role).toBe("user");
      expect(result[1].content).toBe("Hello");
    });

    it("should return empty array when no messages exist", () => {
      const result = loadConversation("s1");
      expect(result).toEqual([]);
    });
  });

  describe("injectToolResult", () => {
    it("should append tool result as assistant message", () => {
      const messages = [
        { role: "user" as const, content: "search for X", timestamp: 1000 },
      ];
      const result = injectToolResult(messages, "websearch", "Found result");

      expect(result).toHaveLength(2);
      expect(result[1].role).toBe("assistant");
      expect(result[1].content).toContain("[Result from websearch]");
      expect(result[1].content).toContain("Found result");
    });

    it("should mutate and return the same array", () => {
      const messages = [{ role: "user" as const, content: "hi", timestamp: 1000 }];
      const result = injectToolResult(messages, "webfetch", "content");

      expect(result).toBe(messages);
    });
  });

  describe("injectSystemPrompt", () => {
    it("should prepend system prompt when none exists", () => {
      const messages = [
        { role: "user" as const, content: "Hello", timestamp: 1000 },
      ];
      const result = injectSystemPrompt(messages, "You are helpful");

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("system");
      expect(result[0].content).toBe("You are helpful");
    });

    it("should not add system prompt if one already exists", () => {
      const messages = [
        { role: "system" as const, content: "Existing prompt", timestamp: 1000 },
        { role: "user" as const, content: "Hello", timestamp: 2000 },
      ];
      const result = injectSystemPrompt(messages, "New prompt");

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe("Existing prompt");
    });
  });

  describe("hasReachedTokenLimit", () => {
    it("should return false (stub)", () => {
      expect(hasReachedTokenLimit([], 1000)).toBe(false);
    });
  });
});
