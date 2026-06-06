import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";

// Use in-memory DB for testing
const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS agent_memory (
    agent_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (agent_id, key)
  )
`);
sqlite.exec("CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent_id)");

vi.mock("@opencode/engine/persistence/database.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => undefined,
          orderBy: () => ({
            all: () => [],
          }),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          run: () => ({ changes: 1 }),
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        run: () => ({ changes: 1 }),
      }),
    }),
  }),
}));

import { agentMemoryGet, agentMemorySet, agentMemoryList, agentMemoryDelete, agentMemoryClear } from "@opencode/engine/tools/memory.js";

describe("agentMemoryGet", () => {
  it("should return undefined for missing key", () => {
    const result = agentMemoryGet("agent-1", "nonexistent");
    expect(result).toBeUndefined();
  });
});

describe("agentMemorySet", () => {
  it("should set a value without throwing", () => {
    expect(() => agentMemorySet("agent-1", "key1", "value1")).not.toThrow();
  });
});

describe("agentMemoryList", () => {
  it("should return empty array for unknown agent", () => {
    const result = agentMemoryList("agent-unknown");
    expect(result).toEqual([]);
  });
});

describe("agentMemoryDelete", () => {
  it("should return true for successful delete", () => {
    const result = agentMemoryDelete("agent-1", "key1");
    expect(result).toBe(true);
  });
});

describe("agentMemoryClear", () => {
  it("should not throw", () => {
    expect(() => agentMemoryClear("agent-1")).not.toThrow();
  });
});
