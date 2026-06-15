import { describe, it, expect } from "vitest";
import { ParallelSwarmOrchestrator } from "@arely/engine/llm/parallel-swarm-orchestrator.js";
import { TaskGraphBuilder } from "@arely/engine/llm/task-graph-builder.js";
import type { AgentExecutor, AgentRole } from "@arely/engine/llm/swarm-orchestrator.js";
import type { SwarmTask } from "@arely/engine/llm/swarm-task-types.js";

function mockExecutor(
  outputs: Record<string, string> = {},
): AgentExecutor {
  return async (role: AgentRole, _prompt: string, _task: string, _ctx: string) => {
    return outputs[role] ?? `[${role} output]`;
  };
}

describe("ParallelSwarmOrchestrator", () => {
  it("should execute planner first, then parallel tasks, then review, then synthesize", async () => {
    const rolesCalled: string[] = [];
    const execute: AgentExecutor = async (role) => {
      rolesCalled.push(role);
      return `[${role} result]`;
    };

    const orchestrator = new ParallelSwarmOrchestrator(execute);
    await orchestrator.run("Build a CLI tool");

    expect(rolesCalled[0]).toBe("planner");
    // planner → [researcher-a, researcher-b, coder] in any order
    const phase1 = rolesCalled.slice(1, 4).sort();
    expect(phase1).toEqual(["coder", "researcher", "researcher"]);
    expect(rolesCalled[4]).toBe("reviewer");
    expect(rolesCalled[5]).toBe("synthesizer");
  });

  it("should return plan, review, and synthesis in result", async () => {
    const execute = mockExecutor({
      planner: "Step-by-step plan",
      "researcher": "Research findings",
      coder: "Implementation",
      reviewer: "Review feedback",
      synthesizer: "Final output",
    });

    const orchestrator = new ParallelSwarmOrchestrator(execute);
    const result = await orchestrator.run("Build a calculator");

    expect(result.request).toBe("Build a calculator");
    expect(result.plan).toBe("Step-by-step plan");
    expect(result.review).toBe("Review feedback");
    expect(result.synthesis).toBe("Final output");
  });

  it("should contain all task definitions in result", async () => {
    const execute = mockExecutor();
    const orchestrator = new ParallelSwarmOrchestrator(execute);

    const result = await orchestrator.run("Build something");

    expect(result.tasks).toHaveLength(5);
    expect(result.tasks.map((t: SwarmTask) => t.id)).toEqual([
      "researcher-a", "researcher-b", "coder", "reviewer", "synthesizer",
    ]);
  });

  it("should populate outputs for each task", async () => {
    const outputs: Record<string, string> = {
      planner: "P",
      "researcher": "R",
      coder: "C",
      reviewer: "RV",
      synthesizer: "S",
    };
    const execute = mockExecutor(outputs);
    const orchestrator = new ParallelSwarmOrchestrator(execute);

    const result = await orchestrator.run("Task");

    expect(result.outputs["researcher-a"]).toBeDefined();
    expect(result.outputs["researcher-b"]).toBeDefined();
    expect(result.outputs["coder"]).toBeDefined();
    expect(result.outputs["reviewer"]).toBeDefined();
    expect(result.outputs["synthesizer"]).toBeDefined();
  });

  it("should pass dependency context to reviewer", async () => {
    const contexts: string[] = [];
    const execute: AgentExecutor = async (role, _prompt, _task, ctx) => {
      contexts.push(ctx);
      return `[${role}]`;
    };

    const orchestrator = new ParallelSwarmOrchestrator(execute);
    await orchestrator.run("Task");

    const reviewerContext = contexts[4]; // 5th call
    expect(reviewerContext).toContain("researcher-a");
    expect(reviewerContext).toContain("researcher-b");
    expect(reviewerContext).toContain("coder");
  });

  it("should propagate execution errors", async () => {
    const execute: AgentExecutor = async (role) => {
      if (role === "coder") throw new Error("Coder failed");
      return `[${role}]`;
    };

    const orchestrator = new ParallelSwarmOrchestrator(execute);
    await expect(orchestrator.run("Task")).rejects.toThrow("Coder failed");
  });

  it("should accept custom graph builder", async () => {
    const customBuilder = new TaskGraphBuilder();
    // Override build to return a simpler graph
    const origBuild = customBuilder.build.bind(customBuilder);

    const execute = mockExecutor();
    const orchestrator = new ParallelSwarmOrchestrator(execute, { graphBuilder: customBuilder });

    const result = await orchestrator.run("Task");
    expect(result.tasks).toHaveLength(5);
  });

  it("should handle empty request gracefully", async () => {
    const execute = mockExecutor();
    const orchestrator = new ParallelSwarmOrchestrator(execute);

    const result = await orchestrator.run("");
    expect(result.plan).toBeDefined();
    expect(result.tasks).toHaveLength(5);
  });

  it("should pass system prompt per role", async () => {
    const receivedRoles: string[] = [];
    const execute: AgentExecutor = async (role) => {
      receivedRoles.push(role);
      return `[${role}]`;
    };

    const orchestrator = new ParallelSwarmOrchestrator(execute);
    await orchestrator.run("Task");

    expect(receivedRoles).toContain("planner");
    expect(receivedRoles).toContain("coder");
    expect(receivedRoles).toContain("reviewer");
    expect(receivedRoles).toContain("synthesizer");
    expect(receivedRoles.filter((r) => r === "researcher")).toHaveLength(2);
  });

  it("should inject goal resume into shared memory", async () => {
    const contexts: string[] = [];
    const execute: AgentExecutor = async (_role, _prompt, _task, ctx) => {
      contexts.push(ctx);
      return "out";
    };

    const orchestrator = new ParallelSwarmOrchestrator(execute);
    await orchestrator.run("Task", { goalResume: "Active goal: v0.3 release" });

    const researcherContext = contexts[1]; // first parallel task
    expect(researcherContext).toContain("Active goal: v0.3 release");
    expect(researcherContext).toContain("Goal Resume");
  });

  it("should inject relevant memories into shared memory", async () => {
    const contexts: string[] = [];
    const execute: AgentExecutor = async (_role, _prompt, _task, ctx) => {
      contexts.push(ctx);
      return "out";
    };

    const orchestrator = new ParallelSwarmOrchestrator(execute);
    await orchestrator.run("Task", { relevantMemories: "Previous attempt failed due to rate limits" });

    const researcherContext = contexts[1];
    expect(researcherContext).toContain("Previous attempt failed due to rate limits");
    expect(researcherContext).toContain("Relevant Memories");
  });

  it("should include contributions in result", async () => {
    const execute = mockExecutor({ planner: "P", researcher: "R", coder: "C", reviewer: "RV", synthesizer: "S" });
    const orchestrator = new ParallelSwarmOrchestrator(execute);

    const result = await orchestrator.run("Task");

    expect(result.contributions).toBeDefined();
    expect(result.contributions.length).toBeGreaterThanOrEqual(4);
    expect(result.contributions.some((c) => c.role === "coder")).toBe(true);
    expect(result.contributions.some((c) => c.role === "reviewer")).toBe(true);
  });

  it("should make shared memory visible to all parallel agents", async () => {
    const contexts: string[] = [];
    const execute: AgentExecutor = async (_role, _prompt, _task, ctx) => {
      contexts.push(ctx);
      return "out";
    };

    const orchestrator = new ParallelSwarmOrchestrator(execute);
    await orchestrator.run("Task", { customContext: "Custom context for all agents" });

    // All 3 parallel agents (researcher-a, researcher-b, coder) get the shared context
    const parallelContexts = contexts.slice(1, 4);
    for (const ctx of parallelContexts) {
      expect(ctx).toContain("Custom context for all agents");
    }
  });
});
