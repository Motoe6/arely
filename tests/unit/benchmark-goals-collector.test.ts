import { describe, it, expect } from "vitest";
import { createGoalsCollector } from "@arely/benchmarks/collectors/goals.js";
import type { Goal, GoalPlan } from "@arely/persistence";

function makeGoal(overrides: Partial<Goal> & { status: Goal["status"] }): Goal {
  return {
    id: "g1", title: "test goal", description: "desc", priority: 1,
    progressPct: 0, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), completedAt: null,
    metadata: {},
    ...overrides,
  };
}

function makePlan(overrides: Partial<GoalPlan> & { status: GoalPlan["status"] }): GoalPlan {
  return {
    id: "p1", goalId: "g1", title: "test plan", description: "",
    status: "in_progress", sortOrder: 1, dependencies: [],
    progressPct: 0, metadata: {}, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("GoalsCollector", () => {
  it("returns empty suite when no goals", () => {
    const collector = createGoalsCollector([], []);
    const result = collector.collect();
    const total = result.metrics.find((m) => m.name === "total_goals");
    expect(total!.value).toBe(0);
  });

  it("reports completion rate with mixed goals", () => {
    const goals = [
      makeGoal({ id: "g1", status: "completed", progressPct: 100 }),
      makeGoal({ id: "g2", status: "active", progressPct: 50 }),
      makeGoal({ id: "g3", status: "active", progressPct: 0 }),
    ];

    const collector = createGoalsCollector(goals, []);
    const result = collector.collect();

    expect(result.metrics.find((m) => m.name === "total_goals")!.value).toBe(3);
    expect(result.metrics.find((m) => m.name === "completed_goals")!.value).toBe(1);
    expect(result.metrics.find((m) => m.name === "active_goals")!.value).toBe(2);
    expect(result.metrics.find((m) => m.name === "completion_rate")!.value).toBeCloseTo(0.333, 1);
  });

  it("reports average progress across goals", () => {
    const goals = [
      makeGoal({ id: "g1", status: "completed", progressPct: 100 }),
      makeGoal({ id: "g2", status: "active", progressPct: 50 }),
    ];

    const collector = createGoalsCollector(goals, []);
    const result = collector.collect();

    const avg = result.metrics.find((m) => m.name === "avg_progress_pct");
    expect(avg!.value).toBe(75);
  });

  it("reports stalled goals (active with 0 progress)", () => {
    const goals = [
      makeGoal({ id: "g1", status: "active", progressPct: 0 }),
      makeGoal({ id: "g2", status: "active", progressPct: 0 }),
      makeGoal({ id: "g3", status: "completed", progressPct: 100 }),
    ];

    const collector = createGoalsCollector(goals, []);
    const result = collector.collect();

    const stalled = result.metrics.find((m) => m.name === "stalled_goals");
    expect(stalled!.value).toBe(2);
    expect(stalled!.passed).toBe(true);
  });

  it("includes plan metrics when plans provided", () => {
    const goals = [makeGoal({ id: "g1", status: "active", progressPct: 50 })];
    const plans = [
      makePlan({ id: "p1", goalId: "g1", status: "in_progress", progressPct: 50 }),
      makePlan({ id: "p2", goalId: "g1", status: "completed", progressPct: 100 }),
    ];

    const collector = createGoalsCollector(goals, plans);
    const result = collector.collect();

    expect(result.metrics.find((m) => m.name === "total_plans")!.value).toBe(2);
    expect(result.metrics.find((m) => m.name === "plan_completion_rate")!.value).toBe(0.5);
  });
});
