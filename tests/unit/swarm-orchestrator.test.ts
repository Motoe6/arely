import { describe, it, expect } from "vitest";
import { SwarmOrchestrator } from "@arely/engine/llm/swarm-orchestrator.js";
import type { AgentExecutor, AgentRole } from "@arely/engine/llm/swarm-types.js";

describe("SwarmOrchestrator", () => {
  function createMockExecutor(
    outputs?: Partial<Record<AgentRole, string>>,
  ): { execute: AgentExecutor; calls: Array<{ role: AgentRole; systemPrompt: string; task: string; context: string }> } {
    const calls: Array<{ role: AgentRole; systemPrompt: string; task: string; context: string }> = [];
    const execute: AgentExecutor = async (role, systemPrompt, task, context) => {
      calls.push({ role, systemPrompt, task, context });
      return outputs?.[role] ?? `[${role} output for: ${task}]`;
    };
    return { execute, calls };
  }

  it("should execute all three roles in order", async () => {
    const { execute, calls } = createMockExecutor();
    const orchestrator = new SwarmOrchestrator(execute);

    const result = await orchestrator.run("Build a calculator");

    expect(calls).toHaveLength(3);
    expect(calls[0].role).toBe("planner");
    expect(calls[1].role).toBe("coder");
    expect(calls[2].role).toBe("reviewer");
  });

  it("should pass previous output as context to the next role", async () => {
    const outputs = {
      planner: "Step 1: design\nStep 2: implement",
      coder: "function calc() {}",
      reviewer: "LGTM",
    };
    const { execute, calls } = createMockExecutor(outputs);
    const orchestrator = new SwarmOrchestrator(execute);

    await orchestrator.run("Build a calculator");

    expect(calls[0].context).toBe("");
    expect(calls[1].context).toBe("Step 1: design\nStep 2: implement");
    expect(calls[2].context).toBe("function calc() {}");
  });

  it("should populate SwarmResult fields from each role", async () => {
    const outputs = {
      planner: "My plan",
      coder: "My code",
      reviewer: "My review",
    };
    const orchestrator = new SwarmOrchestrator(createMockExecutor(outputs).execute);

    const result = await orchestrator.run("Build a calculator");

    expect(result.request).toBe("Build a calculator");
    expect(result.plan).toBe("My plan");
    expect(result.code).toBe("My code");
    expect(result.review).toBe("My review");
    expect(result.steps).toHaveLength(3);
  });

  it("should pass request as task to each role", async () => {
    const { execute, calls } = createMockExecutor();
    const orchestrator = new SwarmOrchestrator(execute);

    await orchestrator.run("Deploy to production");

    for (const call of calls) {
      expect(call.task).toBe("Deploy to production");
    }
  });

  it("should provide role-specific system prompts", async () => {
    const { execute, calls } = createMockExecutor();
    const orchestrator = new SwarmOrchestrator(execute);

    await orchestrator.run("Build a calculator");

    expect(calls[0].systemPrompt).toContain("planning agent");
    expect(calls[1].systemPrompt).toContain("coding agent");
    expect(calls[2].systemPrompt).toContain("code reviewer");
  });

  it("should handle empty request", async () => {
    const { execute } = createMockExecutor();
    const orchestrator = new SwarmOrchestrator(execute);

    const result = await orchestrator.run("");

    expect(result.steps).toHaveLength(3);
  });

  it("should propagate executor errors", async () => {
    const execute: AgentExecutor = async () => {
      throw new Error("LLM failure");
    };
    const orchestrator = new SwarmOrchestrator(execute);

    await expect(orchestrator.run("Build a calculator")).rejects.toThrow("LLM failure");
  });
});
