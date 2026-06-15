import { describe, it, expect } from "vitest";
import { SwarmTaskExecutor, getSystemPrompt } from "@arelyos/engine/llm/swarm-executor.js";
import { SharedSwarmMemory } from "@arelyos/engine/llm/shared-swarm-memory.js";
import type { AgentExecutor, AgentRole } from "@arelyos/engine/llm/swarm-orchestrator.js";
import type { SwarmTask } from "@arelyos/engine/llm/swarm-task-types.js";

describe("getSystemPrompt", () => {
  it("should return prompts for all roles", () => {
    expect(getSystemPrompt("planner")).toContain("planning");
    expect(getSystemPrompt("researcher")).toContain("research");
    expect(getSystemPrompt("coder")).toContain("coding");
    expect(getSystemPrompt("reviewer")).toContain("reviewer");
    expect(getSystemPrompt("synthesizer")).toContain("synthesizer");
  });
});

describe("SwarmTaskExecutor", () => {
  it("should execute a task with the correct role and prompt", async () => {
    const calls: Array<{ role: string; prompt: string; task: string; ctx: string }> = [];
    const execute: AgentExecutor = async (role, prompt, task, ctx) => {
      calls.push({ role, prompt, task, ctx });
      return `${role} executed`;
    };

    const executor = new SwarmTaskExecutor(execute);
    const task: SwarmTask = { id: "t1", role: "coder", goal: "Write code", dependencies: [], instructions: "Write a test" };

    const result = await executor.run(task, "prior context", "Build a tool");

    expect(result).toBe("coder executed");
    expect(calls[0].role).toBe("coder");
    expect(calls[0].prompt).toContain("coding");
    expect(calls[0].task).toContain("Write a test");
    expect(calls[0].ctx).toBe("prior context");
  });

  it("should build dependency context in runWithDependencies", async () => {
    let capturedContext = "";
    const execute: AgentExecutor = async (_role, _prompt, _task, ctx) => {
      capturedContext = ctx;
      return "done";
    };

    const executor = new SwarmTaskExecutor(execute);
    const task: SwarmTask = {
      id: "reviewer",
      role: "reviewer",
      goal: "Review",
      dependencies: ["researcher-a", "coder"],
      instructions: "",
    };
    const outputs: Record<string, string> = {
      "researcher-a": "Research data",
      coder: "Code output",
    };

    await executor.runWithDependencies(task, "Request", outputs);

    expect(capturedContext).toContain("=== researcher-a ===");
    expect(capturedContext).toContain("Research data");
    expect(capturedContext).toContain("=== coder ===");
    expect(capturedContext).toContain("Code output");
  });

  it("should use goal+request as instructions when instructions is empty", async () => {
    let capturedTask = "";
    const execute: AgentExecutor = async (_role, _prompt, task) => {
      capturedTask = task;
      return "done";
    };

    const executor = new SwarmTaskExecutor(execute);
    const task: SwarmTask = { id: "t1", role: "researcher", goal: "Find best practices", dependencies: [], instructions: "" };

    await executor.run(task, "", "Build API");
    expect(capturedTask).toContain("Find best practices");
    expect(capturedTask).toContain("Build API");
  });

  it("should write output to shared memory after runWithSharedMemory", async () => {
    const execute: AgentExecutor = async () => "output result";
    const executor = new SwarmTaskExecutor(execute);
    const task: SwarmTask = { id: "c1", role: "coder", goal: "Code", dependencies: [], instructions: "" };
    const sharedMemory = new SharedSwarmMemory();

    await executor.runWithSharedMemory(task, "Request", {}, sharedMemory);

    const contributions = sharedMemory.getContributionsByRole("coder");
    expect(contributions).toHaveLength(1);
    expect(contributions[0].content).toBe("output result");
    expect(contributions[0].taskId).toBe("c1");
  });

  it("should inject shared memory context alongside dependency context", async () => {
    let capturedContext = "";
    const execute: AgentExecutor = async (_role, _prompt, _task, ctx) => {
      capturedContext = ctx;
      return "done";
    };
    const executor = new SwarmTaskExecutor(execute);
    const task: SwarmTask = { id: "rv1", role: "reviewer", goal: "Review", dependencies: ["coder"], instructions: "" };
    const sharedMemory = new SharedSwarmMemory();
    sharedMemory.inject("Goal: fix security");
    sharedMemory.write("researcher", "r1", "Found a vulnerability");

    await executor.runWithSharedMemory(task, "Request", { coder: "def foo(): pass" }, sharedMemory);

    expect(capturedContext).toContain("=== coder ===");
    expect(capturedContext).toContain("def foo(): pass");
    expect(capturedContext).toContain("Goal: fix security");
    expect(capturedContext).toContain("Found a vulnerability");
    expect(capturedContext).toContain("Shared Working Memory");
  });
});
