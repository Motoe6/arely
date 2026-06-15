import { describe, it, expect } from "vitest";
import { SharedSwarmMemory } from "@arely/engine/llm/shared-swarm-memory.js";

describe("SharedSwarmMemory", () => {
  it("should start empty", () => {
    const mem = new SharedSwarmMemory();
    expect(mem.readAll()).toBe("");
    expect(mem.getAllContributions()).toHaveLength(0);
  });

  it("should store and retrieve a contribution", () => {
    const mem = new SharedSwarmMemory();
    mem.write("researcher", "task-1", "Research findings");
    const all = mem.getAllContributions();
    expect(all).toHaveLength(1);
    expect(all[0].role).toBe("researcher");
    expect(all[0].taskId).toBe("task-1");
    expect(all[0].content).toBe("Research findings");
    expect(typeof all[0].timestamp).toBe("number");
  });

  it("should accumulate multiple contributions", () => {
    const mem = new SharedSwarmMemory();
    mem.write("researcher", "r1", "Data A");
    mem.write("coder", "c1", "Code B");
    expect(mem.getAllContributions()).toHaveLength(2);
  });

  it("should readAll return injected sections and contributions", () => {
    const mem = new SharedSwarmMemory();
    mem.inject("System context");
    mem.write("coder", "c1", "def foo(): pass");
    const output = mem.readAll();
    expect(output).toContain("System context");
    expect(output).toContain("[coder / c1]");
    expect(output).toContain("def foo(): pass");
    expect(output).toContain("---");
  });

  it("should filter contributions by role", () => {
    const mem = new SharedSwarmMemory();
    mem.write("researcher", "r1", "R1");
    mem.write("researcher", "r2", "R2");
    mem.write("coder", "c1", "C1");
    const researchers = mem.getContributionsByRole("researcher");
    expect(researchers).toHaveLength(2);
    const coders = mem.getContributionsByRole("coder");
    expect(coders).toHaveLength(1);
    const reviewers = mem.getContributionsByRole("reviewer");
    expect(reviewers).toHaveLength(0);
  });

  it("should preserve insertion order", () => {
    const mem = new SharedSwarmMemory();
    mem.write("researcher", "r1", "First");
    mem.write("coder", "c1", "Second");
    mem.write("reviewer", "rv1", "Third");
    const all = mem.getAllContributions();
    expect(all[0].content).toBe("First");
    expect(all[1].content).toBe("Second");
    expect(all[2].content).toBe("Third");
  });

  it("should clear all state", () => {
    const mem = new SharedSwarmMemory();
    mem.inject("ctx");
    mem.write("coder", "c1", "code");
    mem.clear();
    expect(mem.readAll()).toBe("");
    expect(mem.getAllContributions()).toHaveLength(0);
  });

  it("should include injected sections in readAll output", () => {
    const mem = new SharedSwarmMemory();
    mem.inject("Section one");
    mem.inject("Section two");
    const output = mem.readAll();
    expect(output).toContain("Section one");
    expect(output).toContain("Section two");
  });

  it("should handle empty writes gracefully", () => {
    const mem = new SharedSwarmMemory();
    mem.write("coder", "c1", "");
    expect(mem.getAllContributions()).toHaveLength(1);
    expect(mem.readAll()).toContain("[coder / c1]");
  });
});
