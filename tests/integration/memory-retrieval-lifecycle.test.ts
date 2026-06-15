import { describe, it, expect, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { setMemory } from "../../packages/engine/src/persistence/memory-store.js";
import { createSession } from "../../packages/engine/src/persistence/session-store.js";
import { MemoryRetrievalService } from "../../packages/engine/src/llm/memory-retrieval-service.js";
import { injectMemoryIntoContext } from "../../packages/engine/src/llm/context-epoch-service.js";

describe("Memory retrieval lifecycle (integration)", () => {
  let service: MemoryRetrievalService;
  let sessionId: string;
  let sessionId2: string;

  beforeEach(() => {
    initTestDb();
    service = new MemoryRetrievalService();
    const s1 = createSession({ query: "retrieval-test", model: "test", toolMode: "native" });
    sessionId = s1.id;
    const s2 = createSession({ query: "other-session", model: "test", toolMode: "native" });
    sessionId2 = s2.id;
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should inject memories into context via injectMemoryIntoContext", async () => {
    await setMemory("mem1", sessionId, "user_preference", "theme", "dark mode", 100, "explicit", []);
    const ctx = await injectMemoryIntoContext(sessionId, "dark theme preference", 5);
    expect(ctx.length).toBe(1);
    expect(ctx[0].role).toBe("system");
    expect(ctx[0].content).toContain("theme");
    expect(ctx[0].content).toContain("dark mode");
  });

  it("should return empty context when no relevant memories", async () => {
    const ctx = await injectMemoryIntoContext(sessionId, "something completely unrelated", 5);
    expect(ctx).toEqual([]);
  });

  it("should isolate sessions — no cross-session leakage", async () => {
    await setMemory("mem1", sessionId, "user_preference", "secret", "session1 secret", 100, "explicit", []);
    const ctx = await injectMemoryIntoContext(sessionId2, "secret", 5);
    expect(ctx.length).toBe(0);
  });

  it("should rank across multiple memory types", async () => {
    await setMemory("m1", sessionId, "user_preference", "lang", "TypeScript", 100, "explicit", []);
    await setMemory("m2", sessionId, "project_fact", "db", "SQLite", 90, "explicit", []);
    await setMemory("m3", sessionId, "architecture_decision", "auth", "JWT tokens", 80, "explicit", []);
    const ctx = await injectMemoryIntoContext(sessionId, "TypeScript and database", 10);
    expect(ctx.length).toBeGreaterThan(0);
    const content = ctx[0].content;
    expect(content).toContain("TypeScript");
    expect(content).toContain("SQLite");
  });

  it("should truncate to limit", async () => {
    for (let i = 0; i < 5; i++) {
      await setMemory(`m${i}`, sessionId, "user_preference", `key${i}`, `value ${i}`, 100, "explicit", []);
    }
    const ctx = await injectMemoryIntoContext(sessionId, "value", 2);
    expect(ctx.length).toBe(1);
    const lineCount = ctx[0].content.split("\n").filter((l) => l.startsWith("-")).length;
    expect(lineCount).toBeLessThanOrEqual(2);
  });
});
