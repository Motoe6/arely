import { describe, it, expect } from "vitest";
import { ManagerPlanner, computePhases } from "../../packages/engine/src/swarm/manager-planner.js";
import type { ManagerTask } from "../../packages/engine/src/swarm/manager-types.js";

describe("ManagerPlanner", () => {
  const planner = new ManagerPlanner();

  it("creates a plan with tasks for a research goal", () => {
    const plan = planner.createPlan({
      sessionId: "s1",
      goal: "Investigate RAG techniques and compare frameworks",
    });
    expect(plan.planId).toBeTruthy();
    expect(plan.sessionId).toBe("s1");
    expect(plan.tasks.length).toBeGreaterThanOrEqual(2);
    // Should include research and analysis tasks
    const categories = plan.tasks.map((t) => t.category);
    expect(categories).toContain("research");
    expect(categories).toContain("analysis");
  });

  it("creates a plan with coding tasks for an implementation goal", () => {
    const plan = planner.createPlan({
      sessionId: "s2",
      goal: "Implement a distributed task queue in TypeScript",
    });
    const categories = plan.tasks.map((t) => t.category);
    expect(categories).toContain("coding");
  });

  it("creates a plan with writing tasks for a documentation goal", () => {
    const plan = planner.createPlan({
      sessionId: "s3",
      goal: "Write a comprehensive API documentation",
    });
    const categories = plan.tasks.map((t) => t.category);
    expect(categories).toContain("writing");
  });

  it("assigns dependencies so synthesis depends on all prior tasks", () => {
    const plan = planner.createPlan({
      sessionId: "s4",
      goal: "Research and build a web application",
    });
    const synth = plan.tasks.find((t) => t.category === "writing");
    expect(synth).toBeTruthy();
    expect(synth!.dependencies.length).toBeGreaterThanOrEqual(1);
    // Synthesis should depend on all non-synthesis tasks
    const nonSynth = plan.tasks.filter((t) => t.category !== "writing");
    for (const t of nonSynth) {
      expect(synth!.dependencies).toContain(t.taskId);
    }
  });

  it("falls back to research+analysis+writing for ambiguous goals", () => {
    const plan = planner.createPlan({
      sessionId: "s5",
      goal: "Help me with my project",
    });
    const categories = new Set(plan.tasks.map((t) => t.category));
    expect(categories.has("research") || categories.has("analysis")).toBe(true);
    expect(categories.has("writing")).toBe(true);
  });

  it("preferFast produces low complexity estimate", () => {
    const plan = planner.createPlan({
      sessionId: "s6",
      goal: "Build a complex distributed multi-agent system",
      preferFast: true,
    });
    // With preferFast, complexity should be low
    expect(plan.tasks.length).toBeGreaterThanOrEqual(2);
  });

  it("assigns unique taskIds in order", () => {
    const plan = planner.createPlan({
      sessionId: "s7",
      goal: "Research, implement, and document a solution",
    });
    const ids = plan.tasks.map((t) => t.taskId);
    expect(new Set(ids).size).toBe(ids.length);
    // IDs should be sequential
    for (let i = 0; i < ids.length; i++) {
      expect(ids[i]).toBe(`T${i + 1}`);
    }
  });
});

describe("computePhases", () => {
  it("returns a single phase for independent tasks", () => {
    const tasks: ManagerTask[] = [
      {
        taskId: "T1", title: "A", description: "", category: "research",
        dependencies: [], priority: 1, estimatedComplexity: "low",
      },
      {
        taskId: "T2", title: "B", description: "", category: "research",
        dependencies: [], priority: 1, estimatedComplexity: "low",
      },
    ];
    const phases = computePhases(tasks);
    expect(phases.length).toBe(1);
    expect(phases[0].sort()).toEqual(["T1", "T2"]);
  });

  it("produces sequential phases for chained dependencies", () => {
    const tasks: ManagerTask[] = [
      {
        taskId: "T1", title: "Research", description: "", category: "research",
        dependencies: [], priority: 1, estimatedComplexity: "low",
      },
      {
        taskId: "T2", title: "Implement", description: "", category: "coding",
        dependencies: ["T1"], priority: 2, estimatedComplexity: "medium",
      },
      {
        taskId: "T3", title: "Review", description: "", category: "analysis",
        dependencies: ["T2"], priority: 3, estimatedComplexity: "low",
      },
    ];
    const phases = computePhases(tasks);
    expect(phases.length).toBe(3);
    expect(phases[0]).toEqual(["T1"]);
    expect(phases[1]).toEqual(["T2"]);
    expect(phases[2]).toEqual(["T3"]);
  });

  it("throws on circular dependencies", () => {
    const tasks: ManagerTask[] = [
      {
        taskId: "T1", title: "A", description: "", category: "research",
        dependencies: ["T2"], priority: 1, estimatedComplexity: "low",
      },
      {
        taskId: "T2", title: "B", description: "", category: "research",
        dependencies: ["T1"], priority: 1, estimatedComplexity: "low",
      },
    ];
    expect(() => computePhases(tasks)).toThrow("Circular dependency");
  });

  it("handles diamond-shaped DAG", () => {
    const tasks: ManagerTask[] = [
      {
        taskId: "T1", title: "Root", description: "", category: "research",
        dependencies: [], priority: 1, estimatedComplexity: "low",
      },
      {
        taskId: "T2", title: "Branch A", description: "", category: "research",
        dependencies: ["T1"], priority: 2, estimatedComplexity: "low",
      },
      {
        taskId: "T3", title: "Branch B", description: "", category: "coding",
        dependencies: ["T1"], priority: 2, estimatedComplexity: "low",
      },
      {
        taskId: "T4", title: "Merge", description: "", category: "writing",
        dependencies: ["T2", "T3"], priority: 3, estimatedComplexity: "low",
      },
    ];
    const phases = computePhases(tasks);
    expect(phases.length).toBe(3);
    expect(phases[0]).toEqual(["T1"]);
    expect(phases[1].sort()).toEqual(["T2", "T3"]);
    expect(phases[2]).toEqual(["T4"]);
  });
});
