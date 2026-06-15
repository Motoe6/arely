import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPersistence = vi.hoisted(() => ({
  setMemory: vi.fn(),
  getMemory: vi.fn().mockReturnValue(null),
  searchMemories: vi.fn().mockReturnValue([]),
  deleteMemory: vi.fn().mockReturnValue(true),
  listBySession: vi.fn().mockReturnValue([]),
  evictExpired: vi.fn().mockReturnValue(0),
  evictByCount: vi.fn().mockReturnValue(0),
}));

vi.mock("@arely/persistence", () => mockPersistence);

import { Memory } from "@arely/sdk";

describe("Memory", () => {
  let memory: Memory;

  beforeEach(() => {
    vi.clearAllMocks();
    memory = new Memory();
  });

  it("throws on set before connect", async () => {
    await expect(memory.set("test", "key", "value")).rejects.toThrow("not available");
  });

  it("allows operations after marking connected", async () => {
    memory.markConnected();
    await expect(memory.set("test", "key", "value")).resolves.toBeUndefined();
  });

  it("returns null from get when no record", async () => {
    memory.markConnected();
    const result = await memory.get("test", "nonexistent");
    expect(result).toBeNull();
  });

  it("deletes a memory", async () => {
    memory.markConnected();
    const result = await memory.delete("test", "key");
    expect(result).toBe(true);
  });
});
