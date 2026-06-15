import { describe, it, expect, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { setMemory, getMemory, searchMemories, listBySession, deleteMemory, evictExpired, evictByCount } from "../../packages/engine/src/persistence/memory-store.js";
import { createSession } from "../../packages/engine/src/persistence/session-store.js";
import { getDb } from "../../packages/engine/src/persistence/database.js";
import { sql } from "drizzle-orm";
import type { MemoryType } from "../../packages/engine/src/llm/memory-types.js";

describe("MemoryStore", () => {
  let sessionId: string;

  beforeEach(() => {
    initTestDb();
    const session = createSession({ query: "test", model: "test", toolMode: "native" });
    sessionId = session.id;
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should set and get a memory", async () => {
    await setMemory("mem1", null, "user_preference", "theme", "dark mode", 100, "explicit", ["ui"]);
    const mem = await getMemory("user_preference", "theme");
    expect(mem).not.toBeNull();
    expect(mem!.value).toBe("dark mode");
    expect(mem!.confidence).toBe(100);
    expect(mem!.tags).toEqual(["ui"]);
    expect(mem!.source).toBe("explicit");
  });

  it("should upsert memory on same type+key", async () => {
    await setMemory("mem1", null, "user_preference", "theme", "dark mode");
    await setMemory("mem2", null, "user_preference", "theme", "light mode", 75);
    const mem = await getMemory("user_preference", "theme");
    expect(mem!.value).toBe("light mode");
    expect(mem!.confidence).toBe(75);
  });

  it("should return null for missing memory", async () => {
    const mem = await getMemory("project_fact", "nonexistent");
    expect(mem).toBeNull();
  });

  it("should search by type", async () => {
    await setMemory("mem1", null, "user_preference", "theme", "dark", 100, "explicit", []);
    await setMemory("mem2", null, "project_fact", "db", "sqlite", 100, "explicit", []);
    const results = await searchMemories(null, { type: "user_preference" });
    expect(results.length).toBe(1);
    expect(results[0].key).toBe("theme");
  });

  it("should search by multiple types", async () => {
    await setMemory("mem1", null, "user_preference", "a", "x", 100, "explicit", []);
    await setMemory("mem2", null, "project_fact", "b", "y", 100, "explicit", []);
    await setMemory("mem3", null, "architecture_decision", "c", "z", 100, "explicit", []);
    const results = await searchMemories(null, { typeIn: ["user_preference", "project_fact"] });
    expect(results.length).toBe(2);
  });

  it("should filter by minConfidence", async () => {
    await setMemory("mem1", null, "user_preference", "a", "x", 90, "explicit", []);
    await setMemory("mem2", null, "user_preference", "b", "y", 50, "explicit", []);
    const results = await searchMemories(null, { type: "user_preference", minConfidence: 80 });
    expect(results.length).toBe(1);
    expect(results[0].key).toBe("a");
  });

  it("should filter by tags", async () => {
    await setMemory("mem1", null, "user_preference", "a", "x", 100, "explicit", ["ui", "frontend"]);
    await setMemory("mem2", null, "user_preference", "b", "y", 100, "explicit", ["backend"]);
    const results = await searchMemories(null, { type: "user_preference", tags: ["ui"] });
    expect(results.length).toBe(1);
    expect(results[0].key).toBe("a");
  });

  it("should list by session", async () => {
    await setMemory("mem1", sessionId, "user_preference", "a", "x", 100, "explicit", []);
    await setMemory("mem2", sessionId, "project_fact", "b", "y", 100, "explicit", []);
    const results = await listBySession(sessionId);
    expect(results.length).toBe(2);
  });

  it("should delete a memory", async () => {
    await setMemory("mem1", null, "user_preference", "theme", "dark", 100, "explicit", []);
    const deleted = await deleteMemory("user_preference", "theme");
    expect(deleted).toBe(true);
    const mem = await getMemory("user_preference", "theme");
    expect(mem).toBeNull();
  });

  it("should return false when deleting nonexistent", async () => {
    const deleted = await deleteMemory("user_preference", "nonexistent");
    expect(deleted).toBe(false);
  });

  it("should evict by count", async () => {
    for (let i = 0; i < 10; i++) {
      await setMemory(`mem${i}`, null, "user_preference", `key${i}`, `val${i}`, 50, "explicit", []);
    }
    const evicted = await evictByCount(5);
    expect(evicted).toBe(5);
    const remaining = await searchMemories(null, { type: "user_preference" });
    expect(remaining.length).toBeLessThanOrEqual(5);
  });

  it("should evict expired memories", async () => {
    await setMemory("mem1", null, "user_preference", "fresh", "val", 100, "explicit", []);
    const db = getDb();
    db.run(sql`
      INSERT INTO memory_store (id, type, key, value, ttl_seconds, last_accessed_at, confidence, source, tags)
      VALUES (${"stale"}, ${"user_preference"}, ${"stale"}, ${"val"}, ${1}, ${"2000-01-01 00:00:00"}, ${100}, ${"explicit"}, ${"[]"})
    `);
    const evicted = await evictExpired();
    expect(evicted).toBe(1);
    const fresh = await getMemory("user_preference", "fresh");
    expect(fresh).not.toBeNull();
    const stale = await getMemory("user_preference", "stale");
    expect(stale).toBeNull();
  });

  it("should support typeIn search", async () => {
    await setMemory("mem1", null, "user_preference", "a", "x", 100, "explicit", []);
    await setMemory("mem2", null, "architecture_decision", "b", "y", 100, "explicit", []);
    const results = await searchMemories(null, { typeIn: ["user_preference", "architecture_decision"] });
    expect(results.length).toBe(2);
  });

  it("should paginate with limit and offset", async () => {
    for (let i = 0; i < 5; i++) {
      await setMemory(`mem${i}`, null, "user_preference", `key${i}`, `val${i}`, 100, "explicit", []);
    }
    const page1 = await searchMemories(null, { type: "user_preference", limit: 2, offset: 0 });
    expect(page1.length).toBe(2);
    const page2 = await searchMemories(null, { type: "user_preference", limit: 2, offset: 2 });
    expect(page2.length).toBe(2);
  });
});
