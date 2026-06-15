import { describe, it, expect } from "vitest";
import { TaskGraphBuilder, computePhases } from "@arelyos/engine/llm/task-graph-builder.js";
import type { SwarmTask } from "@arelyos/engine/llm/swarm-task-types.js";

describe("computePhases", () => {
  it("should return empty phases for no tasks", () => {
    expect(computePhases([])).toEqual([]);
  });

  it("should put a single task in one phase", () => {
    const tasks: SwarmTask[] = [
      { id: "a", role: "coder", goal: "x", dependencies: [], instructions: "" },
    ];
    expect(computePhases(tasks)).toEqual([["a"]]);
  });

  it("should order linear chain sequentially", () => {
    const tasks: SwarmTask[] = [
      { id: "a", role: "planner", goal: "x", dependencies: [], instructions: "" },
      { id: "b", role: "coder", goal: "x", dependencies: ["a"], instructions: "" },
      { id: "c", role: "reviewer", goal: "x", dependencies: ["b"], instructions: "" },
    ];
    expect(computePhases(tasks)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("should group parallel tasks in the same phase", () => {
    const tasks: SwarmTask[] = [
      { id: "a", role: "researcher", goal: "x", dependencies: [], instructions: "" },
      { id: "b", role: "researcher", goal: "y", dependencies: [], instructions: "" },
      { id: "c", role: "coder", goal: "z", dependencies: [], instructions: "" },
    ];
    const phases = computePhases(tasks);
    expect(phases).toHaveLength(1);
    expect(phases[0].sort()).toEqual(["a", "b", "c"]);
  });

  it("should handle diamond DAG", () => {
    const tasks: SwarmTask[] = [
      { id: "root", role: "planner", goal: "x", dependencies: [], instructions: "" },
      { id: "left", role: "researcher", goal: "a", dependencies: ["root"], instructions: "" },
      { id: "right", role: "researcher", goal: "b", dependencies: ["root"], instructions: "" },
      { id: "merge", role: "synthesizer", goal: "c", dependencies: ["left", "right"], instructions: "" },
    ];
    const phases = computePhases(tasks);
    expect(phases).toHaveLength(3);
    expect(phases[0]).toEqual(["root"]);
    expect(phases[1].sort()).toEqual(["left", "right"]);
    expect(phases[2]).toEqual(["merge"]);
  });

  it("should throw on circular dependency", () => {
    const tasks: SwarmTask[] = [
      { id: "a", role: "coder", goal: "x", dependencies: ["b"], instructions: "" },
      { id: "b", role: "coder", goal: "y", dependencies: ["a"], instructions: "" },
    ];
    expect(() => computePhases(tasks)).toThrow("Circular dependency");
  });

  it("should throw on self-loop", () => {
    const tasks: SwarmTask[] = [
      { id: "a", role: "coder", goal: "x", dependencies: ["a"], instructions: "" },
    ];
    expect(() => computePhases(tasks)).toThrow("Circular dependency");
  });

  it("should handle complex multi-phase DAG", () => {
    const tasks: SwarmTask[] = [
      { id: "p", role: "planner", goal: "x", dependencies: [], instructions: "" },
      { id: "r1", role: "researcher", goal: "a", dependencies: ["p"], instructions: "" },
      { id: "r2", role: "researcher", goal: "b", dependencies: ["p"], instructions: "" },
      { id: "c", role: "coder", goal: "c", dependencies: ["p"], instructions: "" },
      { id: "rv", role: "reviewer", goal: "d", dependencies: ["r1", "r2", "c"], instructions: "" },
      { id: "s", role: "synthesizer", goal: "e", dependencies: ["rv"], instructions: "" },
    ];
    const phases = computePhases(tasks);
    expect(phases).toHaveLength(4);
    expect(phases[0]).toEqual(["p"]);
    expect(phases[1].sort()).toEqual(["c", "r1", "r2"]);
    expect(phases[2]).toEqual(["rv"]);
    expect(phases[3]).toEqual(["s"]);
  });
});

describe("TaskGraphBuilder", () => {
  it("should build a standard task graph with 5 tasks and 3 phases", () => {
    const builder = new TaskGraphBuilder();
    const graph = builder.build("my plan", "my request");
    expect(graph.tasks).toHaveLength(5);
    expect(graph.phases).toHaveLength(3);
    expect(graph.phases[0]).toHaveLength(3);
    expect(graph.tasks.map((t) => t.id)).toContain("researcher-a");
    expect(graph.tasks.map((t) => t.id)).toContain("researcher-b");
    expect(graph.tasks.map((t) => t.id)).toContain("coder");
    expect(graph.tasks.map((t) => t.id)).toContain("reviewer");
    expect(graph.tasks.map((t) => t.id)).toContain("synthesizer");
  });
});
