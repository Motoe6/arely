import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { agentMemorySet, agentMemoryGet, agentMemoryList, agentMemoryDelete, agentMemoryClear } from "@arelyos/engine/tools/memory.js";

describe("Agent Memory Integration", () => {
  beforeAll(() => initTestDb());
  afterAll(() => cleanupTestDb());

  it("should set and get values", () => {
    agentMemorySet("agent-1", "last_run", "2024-01-01T00:00:00Z");
    agentMemorySet("agent-1", "processed_count", "42");

    const lastRun = agentMemoryGet("agent-1", "last_run");
    expect(lastRun).toBe("2024-01-01T00:00:00Z");

    const count = agentMemoryGet("agent-1", "processed_count");
    expect(count).toBe("42");
  });

  it("should return undefined for missing keys", () => {
    const result = agentMemoryGet("agent-1", "nonexistent");
    expect(result).toBeUndefined();
  });

  it("should overwrite existing values", () => {
    agentMemorySet("agent-1", "last_run", "2024-06-01T00:00:00Z");
    const updated = agentMemoryGet("agent-1", "last_run");
    expect(updated).toBe("2024-06-01T00:00:00Z");
  });

  it("should isolate memory per agent", () => {
    agentMemorySet("agent-2", "last_run", "agent-2-value");
    const agent1 = agentMemoryGet("agent-1", "last_run");
    const agent2 = agentMemoryGet("agent-2", "last_run");

    expect(agent1).toBe("2024-06-01T00:00:00Z");
    expect(agent2).toBe("agent-2-value");
  });

  it("should list all memory for an agent", () => {
    const records = agentMemoryList("agent-1");
    expect(records.length).toBeGreaterThanOrEqual(2);
    expect(records.some((r) => r.key === "last_run")).toBe(true);
    expect(records.some((r) => r.key === "processed_count")).toBe(true);
    expect(records.every((r) => r.agentId === "agent-1")).toBe(true);
  });

  it("should delete a specific key", () => {
    agentMemorySet("agent-1", "temp_key", "temp_value");
    expect(agentMemoryGet("agent-1", "temp_key")).toBe("temp_value");

    const deleted = agentMemoryDelete("agent-1", "temp_key");
    expect(deleted).toBe(true);
    expect(agentMemoryGet("agent-1", "temp_key")).toBeUndefined();
  });

  it("should clear all memory for an agent", () => {
    agentMemoryClear("agent-1");
    const records = agentMemoryList("agent-1");
    expect(records).toHaveLength(0);
  });

  it("should handle memory for multiple agents separately after clear", () => {
    const agent2Records = agentMemoryList("agent-2");
    expect(agent2Records.length).toBeGreaterThan(0);
    expect(agent2Records.every((r) => r.agentId === "agent-2")).toBe(true);
  });
});
