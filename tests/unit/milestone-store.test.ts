import { describe, it, expect, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import {
  createMilestone,
  getMilestone,
  updateMilestone,
  queryMilestones,
  countMilestones,
  deleteMilestone,
} from "../../packages/engine/src/persistence/milestone-store.js";
import { createGoal } from "../../packages/engine/src/persistence/goal-store.js";
import { createGoalPlan } from "../../packages/engine/src/persistence/goal-plan-store.js";


describe("MilestoneStore", () => {
  let planId: string;

  beforeEach(() => {
    initTestDb();
    const goal = createGoal({ id: "goal1", title: "Test Goal", description: "desc" });
    const plan = createGoalPlan({ id: "plan1", goalId: goal.id, title: "Test Plan", description: "desc" });
    planId = plan.id;
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should create and get a milestone", () => {
    createMilestone({ id: "ms1", planId, description: "Schema done" });
    const m = getMilestone("ms1");
    expect(m).not.toBeNull();
    expect(m!.description).toBe("Schema done");
    expect(m!.status).toBe("pending");
    expect(m!.completedAt).toBeNull();
  });

  it("should return null for missing milestone", () => {
    expect(getMilestone("nonexistent")).toBeNull();
  });

  it("should query milestones by planId", () => {
    createMilestone({ id: "ms1", planId, description: "A" });
    createMilestone({ id: "ms2", planId, description: "B" });
    expect(queryMilestones({ planId }).length).toBe(2);
  });

  it("should query milestones by status", () => {
    createMilestone({ id: "ms1", planId, description: "A" });
    createMilestone({ id: "ms2", planId, description: "B", status: "completed" });
    expect(queryMilestones({ status: "pending" }).length).toBe(1);
    expect(queryMilestones({ status: "completed" }).length).toBe(1);
  });

  it("should update a milestone", () => {
    createMilestone({ id: "ms1", planId, description: "Original" });
    updateMilestone("ms1", { description: "Updated", status: "completed", completedAt: new Date().toISOString() });
    const m = getMilestone("ms1");
    expect(m!.description).toBe("Updated");
    expect(m!.status).toBe("completed");
    expect(m!.completedAt).not.toBeNull();
  });

  it("should complete a milestone", () => {
    createMilestone({ id: "ms1", planId, description: "Task" });
    const now = new Date().toISOString();
    updateMilestone("ms1", { status: "completed", completedAt: now });
    const m = getMilestone("ms1");
    expect(m!.status).toBe("completed");
    expect(m!.completedAt).toBe(now);
  });

  it("should delete a milestone", () => {
    createMilestone({ id: "ms1", planId, description: "Delete" });
    expect(deleteMilestone("ms1")).toBe(true);
    expect(getMilestone("ms1")).toBeNull();
  });

  it("should return false deleting nonexistent", () => {
    expect(deleteMilestone("nonexistent")).toBe(false);
  });

  it("should count milestones", () => {
    createMilestone({ id: "ms1", planId, description: "A" });
    createMilestone({ id: "ms2", planId, description: "B" });
    expect(countMilestones({ planId })).toBe(2);
  });

  it("should support metadata as JSON", () => {
    const meta = { estimate: "2d" };
    createMilestone({ id: "ms1", planId, description: "Meta", metadata: meta });
    expect(getMilestone("ms1")!.metadata).toEqual(meta);
  });

  it("should paginate", () => {
    for (let i = 0; i < 5; i++) {
      createMilestone({ id: `ms${i}`, planId, description: `MS ${i}` });
    }
    expect(queryMilestones({ limit: 2, offset: 0 }).length).toBe(2);
    expect(queryMilestones({ limit: 2, offset: 2 }).length).toBe(2);
  });
});
