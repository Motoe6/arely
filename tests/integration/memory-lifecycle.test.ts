import { describe, it, expect, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { memoryService } from "../../packages/engine/src/llm/memory-service.js";
import { createSession } from "../../packages/engine/src/persistence/session-store.js";

describe("Memory lifecycle (integration)", () => {
  let sessionId: string;

  beforeEach(() => {
    initTestDb();
    const session = createSession({ query: "lifecycle-test", model: "test", toolMode: "native" });
    sessionId = session.id;
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should store and retrieve user_preference across sessions", async () => {
    const sess2 = createSession({ query: "sess2", model: "test", toolMode: "native" });
    await memoryService.setMemory(sessionId, "user_preference", "theme", "dark mode", 100, "explicit", ["ui"]);
    await memoryService.setMemory(sess2.id, "user_preference", "theme", "light mode", 75, "inferred", ["ui"]);
    const mem = await memoryService.getMemory("user_preference", "theme");
    expect(mem).not.toBeNull();
    expect(mem!.value).toBe("light mode");
    expect(mem!.confidence).toBe(75);
  });

  it("should search with typeIn filter", async () => {
    await memoryService.setMemory(sessionId, "user_preference", "lang", "TypeScript", 100, "explicit", ["lang"]);
    await memoryService.setMemory(sessionId, "project_fact", "database", "SQLite", 100, "explicit", ["infra"]);
    const results = await memoryService.searchMemories(sessionId, { typeIn: ["user_preference", "project_fact"] });
    expect(results.length).toBe(2);
  });

  it("should handle eviction lifecycle", async () => {
    await memoryService.setMemory(sessionId, "user_preference", "key1", "val1", 50, "explicit", []);
    await memoryService.setMemory(sessionId, "user_preference", "key2", "val2", 50, "explicit", []);
    await memoryService.setMemory(sessionId, "user_preference", "key3", "val3", 50, "explicit", []);
    const evicted = await memoryService.evictByCount(2);
    expect(evicted).toBe(1);
    const remaining = await memoryService.searchMemories(sessionId, { type: "user_preference" });
    expect(remaining.length).toBe(2);
  });

  it("should store derived summaries via summarizeAndStore", async () => {
    await memoryService.summarizeAndStore(sessionId, "conversation_summary", "session_summary_sess1", "User prefers Python for scripting tasks", "derived", ["lang", "scripting"]);
    const mem = await memoryService.getMemory("conversation_summary", "session_summary_sess1");
    expect(mem).not.toBeNull();
    expect(mem!.value).toBe("User prefers Python for scripting tasks");
    expect(mem!.source).toBe("derived");
    expect(mem!.tags).toEqual(["lang", "scripting"]);
  });

  it("should delete memory correctly", async () => {
    await memoryService.setMemory(sessionId, "user_preference", "editor", "vscode", 100, "explicit", []);
    const deleted = await memoryService.deleteMemory("user_preference", "editor");
    expect(deleted).toBe(true);
    const mem = await memoryService.getMemory("user_preference", "editor");
    expect(mem).toBeNull();
  });
});
