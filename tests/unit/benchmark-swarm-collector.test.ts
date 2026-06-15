import { describe, it, expect } from "vitest";
import { createSwarmCollector } from "@arelyos/benchmarks/collectors/swarm.js";
import type { ParallelSwarmResult } from "@arelyos/engine/llm/swarm-task-types.js";

function makeResult(overrides: Partial<ParallelSwarmResult> & { tasksCount?: number; contributionsCount?: number }): ParallelSwarmResult {
  const tasks = Array.from({ length: overrides.tasksCount ?? 2 }, (_, i) => ({
    id: `t${i}`, role: (i === 0 ? "planner" : "coder") as "planner" | "coder",
    goal: "test", dependencies: [], instructions: "",
  }));
  const contributions = Array.from({ length: overrides.contributionsCount ?? 0 }, (_, i) => ({
    role: (i === 0 ? "planner" : (i === 1 ? "coder" : "reviewer")) as "planner" | "coder" | "reviewer",
    taskId: `t${i}`, content: `output ${i}`, timestamp: Date.now(),
  }));

  return {
    request: "test",
    plan: "plan",
    tasks,
    outputs: tasks.reduce((acc, t) => ({ ...acc, [t.id]: "done" }), {} as Record<string, string>),
    review: "looks good",
    synthesis: "final result",
    contributions,
    ...overrides,
  };
}

describe("SwarmCollector", () => {
  it("returns empty suite when no results provided", () => {
    const collector = createSwarmCollector([]);
    const result = collector.collect();
    expect(result.metrics.find((m) => m.name === "swarm_runs")!.value).toBe(0);
  });

  it("reports run count and avg tasks", () => {
    const results = [
      makeResult({ tasksCount: 3, contributionsCount: 3 }),
      makeResult({ tasksCount: 5, contributionsCount: 5 }),
    ];

    const collector = createSwarmCollector(results);
    const result = collector.collect();

    expect(result.metrics.find((m) => m.name === "swarm_runs")!.value).toBe(2);
    expect(result.metrics.find((m) => m.name === "avg_tasks_per_run")!.value).toBe(4);
  });

  it("reports contribution counts by role", () => {
    const results = [
      makeResult({ tasksCount: 3, contributionsCount: 3 }),
    ];

    const collector = createSwarmCollector(results);
    const result = collector.collect();

    const plannerContribs = result.metrics.find((m) => m.name === "contributions_by_role__planner");
    expect(plannerContribs!.value).toBeGreaterThan(0);
  });

  it("detects review and synthesis rates", () => {
    const results = [
      makeResult({ review: "approve", synthesis: "summary", contributionsCount: 2 }),
      makeResult({ review: "", synthesis: "", contributionsCount: 0 }),
    ];

    const collector = createSwarmCollector(results);
    const result = collector.collect();

    expect(result.metrics.find((m) => m.name === "review_rate")!.value).toBe(0.5);
    expect(result.metrics.find((m) => m.name === "synthesis_rate")!.value).toBe(0.5);
  });

  it("handles results with no contributions", () => {
    const results = [makeResult({ tasksCount: 1, contributionsCount: 0 })];

    const collector = createSwarmCollector(results);
    const result = collector.collect();

    expect(result.metrics.find((m) => m.name === "avg_contributions_per_run")!.value).toBe(0);
  });
});
