import { describe, it, expect, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import {
  createGoalPlan,
  getGoalPlan,
  updateGoalPlan,
  queryGoalPlans,
  countGoalPlans,
  deleteGoalPlan,
} from "../../packages/engine/src/persistence/goal-plan-store.js";
import { createGoal } from "../../packages/engine/src/persistence/goal-store.js";

describe("GoalPlanStore", () => {
  let goalId: string;

  beforeEach(() => {
    initTestDb();
    const goal = createGoal({ id: "goal1", title: "Test Goal", description: "desc" });
    goalId = goal.id;
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should create and get a goal plan", () => {
    createGoalPlan({ id: "p1", goalId, title: "Plan A", description: "desc" });
    const p = getGoalPlan("p1");
    expect(p).not.toBeNull();
    expect(p!.title).toBe("Plan A");
    expect(p!.status).toBe("pending");
    expect(p!.goalId).toBe(goalId);
    expect(p!.dependencies).toEqual([]);
  });

  it("should return null for missing plan", () => {
    expect(getGoalPlan("nonexistent")).toBeNull();
  });

  it("should query plans by goalId", () => {
    createGoalPlan({ id: "p1", goalId, title: "A", description: "d" });
    createGoalPlan({ id: "p2", goalId, title: "B", description: "d" });
    expect(queryGoalPlans({ goalId }).length).toBe(2);
  });

  it("should query plans by status", () => {
    createGoalPlan({ id: "p1", goalId, title: "A", description: "d" });
    createGoalPlan({ id: "p2", goalId, title: "B", description: "d", status: "completed", progressPct: 100 });
    expect(queryGoalPlans({ status: "pending" }).length).toBe(1);
    expect(queryGoalPlans({ status: "completed" }).length).toBe(1);
  });

  it("should update a plan", () => {
    createGoalPlan({ id: "p1", goalId, title: "Original", description: "d" });
    updateGoalPlan("p1", { title: "Updated", status: "in_progress" });
    const p = getGoalPlan("p1");
    expect(p!.title).toBe("Updated");
    expect(p!.status).toBe("in_progress");
  });

  it("should update progress", () => {
    createGoalPlan({ id: "p1", goalId, title: "Progress", description: "d" });
    updateGoalPlan("p1", { progressPct: 75 });
    expect(getGoalPlan("p1")!.progressPct).toBe(75);
  });

  it("should support dependencies serialization", () => {
    createGoalPlan({ id: "p1", goalId, title: "Dependent", description: "d", dependencies: ["p0", "p_prev"] });
    const p = getGoalPlan("p1");
    expect(p!.dependencies).toEqual(["p0", "p_prev"]);
  });

  it("should order by sortOrder field", () => {
    createGoalPlan({ id: "p1", goalId, title: "First", description: "d", sortOrder: 1 });
    createGoalPlan({ id: "p2", goalId, title: "Second", description: "d", sortOrder: 2 });
    const results = queryGoalPlans({ goalId });
    expect(results[0].id).toBe("p1");
    expect(results[1].id).toBe("p2");
  });

  it("should paginate", () => {
    for (let i = 0; i < 5; i++) {
      createGoalPlan({ id: `p${i}`, goalId, title: `Plan ${i}`, description: "d" });
    }
    expect(queryGoalPlans({ limit: 2, offset: 0 }).length).toBe(2);
    expect(queryGoalPlans({ limit: 2, offset: 2 }).length).toBe(2);
  });

  it("should delete a plan", () => {
    createGoalPlan({ id: "p1", goalId, title: "Delete", description: "d" });
    expect(deleteGoalPlan("p1")).toBe(true);
    expect(getGoalPlan("p1")).toBeNull();
  });

  it("should return false deleting nonexistent", () => {
    expect(deleteGoalPlan("nonexistent")).toBe(false);
  });

  it("should count plans", () => {
    createGoalPlan({ id: "p1", goalId, title: "A", description: "d" });
    createGoalPlan({ id: "p2", goalId, title: "B", description: "d" });
    expect(countGoalPlans({ goalId })).toBe(2);
  });

  it("should support metadata as JSON", () => {
    const meta = { tags: ["core"], priority: "high" };
    createGoalPlan({ id: "p1", goalId, title: "Meta", description: "d", metadata: meta });
    expect(getGoalPlan("p1")!.metadata).toEqual(meta);
  });
});
