import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { setMemory } from "../../packages/engine/src/persistence/memory-store.js";
import { MemoryRetrievalService } from "../../packages/engine/src/llm/memory-retrieval-service.js";

describe("MemoryRetrievalService", () => {
  let service: MemoryRetrievalService;

  beforeEach(() => {
    initTestDb();
    service = new MemoryRetrievalService();
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should return empty array when no memories", async () => {
    const result = await service.getRelevant({ query: "hello", limit: 10 });
    expect(result).toEqual([]);
  });

  it("should rank relevant memories higher", async () => {
    await setMemory("mem1", null, "user_preference", "theme", "dark mode for all UIs", 100, "explicit", []);
    await setMemory("mem2", null, "project_fact", "database", "project uses SQLite", 100, "explicit", []);
    const result = await service.getRelevant({ query: "dark theme preference", limit: 10 });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].key).toBe("theme");
    expect(result[0].relevanceScore).toBeGreaterThan(0);
  });

  it("should score based on confidence weighting", async () => {
    await setMemory("mem1", null, "user_preference", "a", "likes async code", 100, "explicit", []);
    await setMemory("mem2", null, "user_preference", "b", "likes async code", 50, "explicit", []);
    const result = await service.getRelevant({ query: "async coding preference", limit: 10 });
    expect(result.length).toBe(2);
    expect(result[0].key).toBe("a");
    expect(result[0].relevanceScore).toBeGreaterThan(result[1].relevanceScore);
  });

  it("should apply recency boost for recently accessed memories", () => {
    const boost = service.recencyBoost(new Date().toISOString());
    expect(boost).toBeGreaterThan(0.9);
    const oldBoost = service.recencyBoost("2000-01-01T00:00:00.000Z");
    expect(oldBoost).toBe(0);
  });

  it("should return 0 recency for null lastAccessedAt", () => {
    expect(service.recencyBoost(null)).toBe(0);
  });

  it("should compute simple similarity correctly", () => {
    const sim1 = service.simpleSimilarity("dark mode UI theme", "dark theme");
    expect(sim1).toBeGreaterThan(0);
    const sim2 = service.simpleSimilarity("database connection pool", "pizza toppings");
    expect(sim2).toBe(0);
    const sim3 = service.simpleSimilarity("", "");
    expect(sim3).toBe(0);
  });

  it("should handle partial token overlap (substring)", () => {
    const sim = service.simpleSimilarity("async workflow preference", "async");
    expect(sim).toBeGreaterThan(0);
  });

  it("should respect limit parameter", async () => {
    await setMemory("mem1", null, "user_preference", "a", "likes async", 100, "explicit", []);
    await setMemory("mem2", null, "user_preference", "b", "likes promises", 100, "explicit", []);
    await setMemory("mem3", null, "user_preference", "c", "likes callbacks", 100, "explicit", []);
    const result = await service.getRelevant({ query: "likes", limit: 2 });
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("should filter by types", async () => {
    await setMemory("mem1", null, "user_preference", "a", "likes async", 100, "explicit", []);
    await setMemory("mem2", null, "project_fact", "b", "uses SQLite", 100, "explicit", []);
    const result = await service.getRelevant({ query: "likes async", types: ["project_fact"], limit: 10 });
    const typeKeys = result.map((m) => m.type);
    expect(typeKeys.every((t) => t === "project_fact")).toBe(true);
  });

  it("should filter by minConfidence", async () => {
    await setMemory("mem1", null, "user_preference", "a", "likes async", 10, "explicit", []);
    const result = await service.getRelevant({ query: "likes async", minConfidence: 50 });
    expect(result.length).toBe(0);
  });

  it("should include access count in score", async () => {
    const db = (await import("../../packages/engine/src/persistence/database.js")).getDb();
    const { sql } = await import("drizzle-orm");
    // Insert with high accessCount via raw SQL
    db.run(sql`
      INSERT INTO memory_store (id, type, key, value, confidence, source, tags, access_count)
      VALUES (${"frequent"}, ${"user_preference"}, ${"freq"}, ${"frequently accessed memory"}, ${100}, ${"explicit"}, ${"[]"}, ${100})
    `);
    const result = await service.getRelevant({ query: "frequently accessed", limit: 10 });
    expect(result.length).toBe(1);
    expect(result[0].relevanceScore).toBeGreaterThan(0);
  });
});
