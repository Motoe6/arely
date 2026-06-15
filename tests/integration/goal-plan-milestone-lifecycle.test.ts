import { describe, it, expect, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createGoal, getGoal } from "../../packages/engine/src/persistence/goal-store.js";
import {
  createGoalPlan,
  getGoalPlan,
  updateGoalPlan,
  queryGoalPlans,
} from "../../packages/engine/src/persistence/goal-plan-store.js";
import {
  createMilestone,
  getMilestone,
  queryMilestones,
  updateMilestone,
  deleteMilestone,
} from "../../packages/engine/src/persistence/milestone-store.js";

describe("Goal → Plan → Milestone Lifecycle", () => {
  beforeEach(() => {
    initTestDb();
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should create a complete goal→plan→milestone hierarchy", () => {
    const goal = createGoal({ id: "g1", title: "Build Feature", description: "Implement X" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "Phase 1", description: "Setup" });
    const ms1 = createMilestone({ id: "ms1", planId: plan.id, description: "Schema" });
    const ms2 = createMilestone({ id: "ms2", planId: plan.id, description: "Store" });

    expect(getGoal("g1")).not.toBeNull();
    expect(getGoalPlan("p1")).not.toBeNull();
    expect(getMilestone("ms1")!.planId).toBe(plan.id);
    expect(queryMilestones({ planId: plan.id }).length).toBe(2);
  });

  it("should propagate milestone completion to plan progress", () => {
    const goal = createGoal({ id: "g1", title: "Goal", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "Plan", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "A" });
    createMilestone({ id: "ms2", planId: plan.id, description: "B" });
    createMilestone({ id: "ms3", planId: plan.id, description: "C" });

    const now = new Date().toISOString();
    updateMilestone("ms1", { status: "completed", completedAt: now });
    expect(getGoalPlan("p1")!.progressPct).toBe(33);

    updateMilestone("ms2", { status: "completed", completedAt: now });
    expect(getGoalPlan("p1")!.progressPct).toBe(66);

    updateMilestone("ms3", { status: "completed", completedAt: now });
    const p = getGoalPlan("p1");
    expect(p!.progressPct).toBe(100);
    expect(p!.status).toBe("completed");
  });

  it("should propagate plan progress to goal progress", () => {
    const goal = createGoal({ id: "g1", title: "Goal", description: "d" });
    createGoalPlan({ id: "p1", goalId: goal.id, title: "Plan A", description: "d" });
    createGoalPlan({ id: "p2", goalId: goal.id, title: "Plan B", description: "d" });

    updateGoalPlan("p1", { progressPct: 50 });
    expect(getGoal("g1")!.progressPct).toBe(25);

    updateGoalPlan("p1", { progressPct: 100 });
    expect(getGoal("g1")!.progressPct).toBe(50);

    updateGoalPlan("p2", { progressPct: 100 });
    const g = getGoal("g1");
    expect(g!.progressPct).toBe(100);
    expect(g!.status).toBe("completed");
    expect(g!.completedAt).not.toBeNull();
  });

  it("should auto-complete plan when all milestones done", () => {
    const goal = createGoal({ id: "g1", title: "Goal", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "Plan", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "Only" });
    const now = new Date().toISOString();
    updateMilestone("ms1", { status: "completed", completedAt: now });
    expect(getGoalPlan("p1")!.status).toBe("completed");
  });

  it("should handle multiple goals with isolated progress", () => {
    const g1 = createGoal({ id: "g1", title: "Goal 1", description: "d" });
    const g2 = createGoal({ id: "g2", title: "Goal 2", description: "d" });

    createGoalPlan({ id: "p1", goalId: g1.id, title: "G1 Plan", description: "d", progressPct: 100 });
    createGoalPlan({ id: "p2", goalId: g2.id, title: "G2 Plan", description: "d", progressPct: 0 });

    expect(getGoal("g1")!.progressPct).toBe(100);
    expect(getGoal("g2")!.progressPct).toBe(0);
  });

  it("should handle milestone deletion and recompute progress", () => {
    const goal = createGoal({ id: "g1", title: "Goal", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "Plan", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "A" });
    createMilestone({ id: "ms2", planId: plan.id, description: "B" });
    createMilestone({ id: "ms3", planId: plan.id, description: "C" });

    const now = new Date().toISOString();
    updateMilestone("ms1", { status: "completed", completedAt: now });
    updateMilestone("ms2", { status: "completed", completedAt: now });

    expect(getGoalPlan("p1")!.progressPct).toBe(66);

    deleteMilestone("ms3");
    expect(getGoalPlan("p1")!.progressPct).toBe(100);
  });
});
