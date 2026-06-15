import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GoalResumeService } from "@arely/engine/llm/goal-resume-service.js";
import type { ResumeContext } from "@arely/engine/llm/goal-resume-service.js";
import {
  createGoal,
  createGoalPlan,
  createMilestone,
  updateGoal,
} from "@arely/persistence";
import { initTestDb, cleanupTestDb } from "../setup.js";

describe("GoalResumeService", () => {
  let service: GoalResumeService;

  beforeEach(() => {
    initTestDb();
    service = new GoalResumeService();
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should return empty context when no active goals", () => {
    const ctx = service.buildResumeContext("session-1");
    expect(ctx.activeGoals).toHaveLength(0);
    expect(ctx.plans).toHaveLength(0);
    expect(ctx.milestones).toHaveLength(0);
    expect(ctx.prioritizedMilestones).toHaveLength(0);
  });

  it("should return no InjectedMemoryMessages when no active goals", () => {
    const msgs = service.injectResumeContext("session-1");
    expect(msgs).toHaveLength(0);
  });

  it("should include a single active goal with its plans and milestones", () => {
    createGoal({ id: "g1", title: "Build Feature", description: "The feature" });
    createGoalPlan({ id: "p1", goalId: "g1", title: "Phase 1", description: "d", sortOrder: 0 });
    createMilestone({ id: "ms1", planId: "p1", description: "Design" });
    createMilestone({ id: "ms2", planId: "p1", description: "Implement" });

    const ctx = service.buildResumeContext("session-1");

    expect(ctx.activeGoals).toHaveLength(1);
    expect(ctx.activeGoals[0].title).toBe("Build Feature");
    expect(ctx.plans).toHaveLength(1);
    expect(ctx.milestones).toHaveLength(2);
    expect(ctx.prioritizedMilestones).toHaveLength(2);
  });

  it("should prioritize pending milestones by utility (weight-based)", () => {
    createGoal({ id: "g1", title: "Goal 1", description: "d" });
    createGoalPlan({ id: "p1", goalId: "g1", title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: "p1", description: "Heavy", weight: 5 });
    createMilestone({ id: "ms2", planId: "p1", description: "Light", weight: 1 });

    const ctx = service.buildResumeContext("session-1");

    expect(ctx.prioritizedMilestones).toHaveLength(2);
    expect(ctx.prioritizedMilestones[0].description).toBe("Heavy");
    expect(ctx.prioritizedMilestones[1].description).toBe("Light");
    expect(ctx.prioritizedMilestones[0].utility).toBeGreaterThan(ctx.prioritizedMilestones[1].utility);
  });

  it("should respect the limit parameter", () => {
    createGoal({ id: "g1", title: "Goal", description: "d" });
    createGoalPlan({ id: "p1", goalId: "g1", title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: "p1", description: "A" });
    createMilestone({ id: "ms2", planId: "p1", description: "B" });
    createMilestone({ id: "ms3", planId: "p1", description: "C" });

    const ctx = service.buildResumeContext("session-1", 2);

    expect(ctx.prioritizedMilestones).toHaveLength(2);
    expect(ctx.milestones).toHaveLength(3);
  });

  it("should only include active goals (skip completed)", () => {
    createGoal({ id: "g1", title: "Active", description: "d" });
    createGoal({ id: "g2", title: "Done", description: "d", status: "completed", progressPct: 100 });

    const ctx = service.buildResumeContext("session-1");

    expect(ctx.activeGoals).toHaveLength(1);
    expect(ctx.activeGoals[0].title).toBe("Active");
  });

  it("should only include paused goals when active", () => {
    createGoal({ id: "g1", title: "Paused", description: "d", status: "paused" });

    const ctx = service.buildResumeContext("session-1");

    expect(ctx.activeGoals).toHaveLength(0);
  });

  it("should handle multiple goals independently", () => {
    createGoal({ id: "g1", title: "Goal A", description: "d" });
    createGoal({ id: "g2", title: "Goal B", description: "d" });
    createGoalPlan({ id: "p1", goalId: "g1", title: "PA", description: "d" });
    createGoalPlan({ id: "p2", goalId: "g2", title: "PB", description: "d" });
    createMilestone({ id: "ms1", planId: "p1", description: "A1" });
    createMilestone({ id: "ms2", planId: "p2", description: "B1" });

    const ctx = service.buildResumeContext("session-1");

    expect(ctx.activeGoals).toHaveLength(2);
    expect(ctx.plans).toHaveLength(2);
    expect(ctx.prioritizedMilestones).toHaveLength(2);
  });

  it("should only include pending milestones (skip completed)", () => {
    createGoal({ id: "g1", title: "Goal", description: "d" });
    createGoalPlan({ id: "p1", goalId: "g1", title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: "p1", description: "Pending" });
    createMilestone({ id: "ms2", planId: "p1", description: "Done", status: "completed" });

    const ctx = service.buildResumeContext("session-1");

    expect(ctx.milestones).toHaveLength(2);
    expect(ctx.prioritizedMilestones).toHaveLength(1);
    expect(ctx.prioritizedMilestones[0].description).toBe("Pending");
  });

  it("should compute utility correctly for each milestone", () => {
    createGoal({ id: "g1", title: "Goal", description: "d" });
    createGoalPlan({ id: "p1", goalId: "g1", title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: "p1", description: "A", weight: 2 });
    createMilestone({ id: "ms2", planId: "p1", description: "B", weight: 2 });

    const ctx = service.buildResumeContext("session-1");

    expect(ctx.prioritizedMilestones).toHaveLength(2);
    expect(ctx.prioritizedMilestones[0].utility).toBeGreaterThan(0);
    expect(ctx.prioritizedMilestones[0].milestoneId).toBeDefined();
    expect(ctx.prioritizedMilestones[0].goalId).toBe("g1");
    expect(ctx.prioritizedMilestones[0].planId).toBe("p1");
  });

  it("should format InjectedMemoryMessage with [Goal Resume] header", () => {
    createGoal({ id: "g1", title: "Build", description: "d" });
    createGoalPlan({ id: "p1", goalId: "g1", title: "Phase 1", description: "d" });
    createMilestone({ id: "ms1", planId: "p1", description: "Design API" });

    const msgs = service.injectResumeContext("session-1");

    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("[Goal Resume]");
    expect(msgs[0].content).toContain("Goal: Build");
    expect(msgs[0].content).toContain("Progress: 0%");
    expect(msgs[0].content).toContain("Current Plan: Phase 1");
    expect(msgs[0].content).toContain("Highest Utility Tasks:");
    expect(msgs[0].content).toContain("Design API");
    expect(typeof msgs[0].timestamp).toBe("number");
  });

  it("should show the correct current plan in resume context", () => {
    createGoal({ id: "g1", title: "Goal", description: "d" });
    createGoalPlan({ id: "p1", goalId: "g1", title: "Phase 1", description: "d", sortOrder: 0, status: "in_progress" });
    createGoalPlan({ id: "p2", goalId: "g1", title: "Phase 2", description: "d", sortOrder: 1, status: "pending" });
    createMilestone({ id: "ms1", planId: "p1", description: "Task" });

    const msgs = service.injectResumeContext("session-1");

    expect(msgs[0].content).toContain("Current Plan: Phase 1");
  });

  it("should include multiple goals in format", () => {
    createGoal({ id: "g1", title: "Goal A", description: "d" });
    createGoal({ id: "g2", title: "Goal B", description: "d" });
    createGoalPlan({ id: "p1", goalId: "g1", title: "PA", description: "d" });
    createGoalPlan({ id: "p2", goalId: "g2", title: "PB", description: "d" });
    createMilestone({ id: "ms1", planId: "p1", description: "A1" });
    createMilestone({ id: "ms2", planId: "p2", description: "B1" });

    const msgs = service.injectResumeContext("session-1");

    expect(msgs[0].content).toContain("Goal: Goal A");
    expect(msgs[0].content).toContain("Goal: Goal B");
    expect(msgs[0].content).toContain("Highest Utility Tasks:");
    expect(msgs[0].content).toContain("A1");
    expect(msgs[0].content).toContain("B1");
  });
});
