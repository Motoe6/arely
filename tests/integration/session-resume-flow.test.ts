import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GoalResumeService } from "@arely/engine/llm/goal-resume-service.js";
import {
  createGoal,
  createGoalPlan,
  createMilestone,
  queryGoals,
  queryGoalPlans,
  queryMilestones,
} from "@arely/persistence";
import { initTestDb, cleanupTestDb } from "../setup.js";

describe("Session Resume Flow", () => {
  let resumeService: GoalResumeService;

  beforeEach(() => {
    initTestDb();
    resumeService = new GoalResumeService();
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should resume a session with a single active goal", () => {
    createGoal({ id: "g1", title: "Build Agent OS", description: "Complete the agent operating system" });
    createGoalPlan({ id: "p1", goalId: "g1", title: "Session Resume", description: "Implement T13.3", sortOrder: 0 });
    createGoalPlan({ id: "p2", goalId: "g1", title: "Self-Improvement", description: "Implement T14", sortOrder: 1, status: "pending" });
    createMilestone({ id: "ms1", planId: "p1", description: "Types", weight: 1 });
    createMilestone({ id: "ms2", planId: "p1", description: "Service", weight: 2 });
    createMilestone({ id: "ms3", planId: "p1", description: "Tests", weight: 1 });
    createMilestone({ id: "ms4", planId: "p2", description: "Design", weight: 3 });

    const msgs = resumeService.injectResumeContext("session-abc", 3);

    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].timestamp).toBeGreaterThan(0);

    const content = msgs[0].content;

    expect(content).toContain("[Goal Resume]");
    expect(content).toContain("Goal: Build Agent OS");
    expect(content).toContain("Progress: 0%");
    expect(content).toContain("Current Plan: Session Resume");

    expect(content).toContain("Highest Utility Tasks:");
    expect(content).toContain("Design");
    expect(content).toContain("Service");
    expect(content).toContain("Types");
    expect(content).not.toContain("Tests");
    expect(content).toContain("Utility:");
  });

  it("should resume with multiple active goals", () => {
    createGoal({ id: "g1", title: "Primary Goal", description: "Main objective" });
    createGoal({ id: "g2", title: "Secondary Goal", description: "Side objective" });
    createGoalPlan({ id: "p1", goalId: "g1", title: "Main Plan", description: "d" });
    createGoalPlan({ id: "p2", goalId: "g2", title: "Side Plan", description: "d" });
    createMilestone({ id: "ms1", planId: "p1", description: "Critical", weight: 5 });
    createMilestone({ id: "ms2", planId: "p2", description: "Minor", weight: 1 });

    const msgs = resumeService.injectResumeContext("session-xyz");

    expect(msgs).toHaveLength(1);
    const content = msgs[0].content;
    expect(content).toContain("Goal: Primary Goal");
    expect(content).toContain("Goal: Secondary Goal");

    const criticalIndex = content.indexOf("Critical");
    const minorIndex = content.indexOf("Minor");
    expect(criticalIndex).toBeLessThan(minorIndex);
  });

  it("should handle mixed goal statuses", () => {
    createGoal({ id: "g1", title: "Active Goal", description: "d" });
    createGoal({ id: "g2", title: "Completed", description: "d", status: "completed", progressPct: 100 });
    createGoal({ id: "g3", title: "Paused", description: "d", status: "paused" });
    createGoal({ id: "g4", title: "Abandoned", description: "d", status: "abandoned" });

    const ctx = resumeService.buildResumeContext("session-1");

    expect(ctx.activeGoals).toHaveLength(1);
    expect(ctx.activeGoals[0].title).toBe("Active Goal");
  });

  it("should return empty context when no goals exist at all", () => {
    const msgs = resumeService.injectResumeContext("session-empty");
    expect(msgs).toHaveLength(0);

    const ctx = resumeService.buildResumeContext("session-empty");
    expect(ctx.activeGoals).toHaveLength(0);
  });

  it("should include progress percentages in context", () => {
    createGoal({ id: "g1", title: "Half Done", description: "d", progressPct: 50 });
    createGoalPlan({ id: "p1", goalId: "g1", title: "Plan", description: "d", progressPct: 50 });
    createMilestone({ id: "ms1", planId: "p1", description: "Remaining" });

    const msgs = resumeService.injectResumeContext("session-1");

    expect(msgs[0].content).toContain("Progress: 50%");
  });

  it("should persist goals and plans correctly for resume", () => {
    createGoal({ id: "g1", title: "Persisted", description: "d" });
    createGoalPlan({ id: "p1", goalId: "g1", title: "Plan", description: "d" });
    createMilestone({ id: "ms1", planId: "p1", description: "Task A" });
    createMilestone({ id: "ms2", planId: "p1", description: "Task B" });

    const queriedGoals = queryGoals({ status: "active" });
    expect(queriedGoals).toHaveLength(1);
    expect(queriedGoals[0].title).toBe("Persisted");

    const plans = queryGoalPlans({ goalId: "g1" });
    expect(plans).toHaveLength(1);
    expect(plans[0].title).toBe("Plan");

    const milestones = queryMilestones({ planId: "p1" });
    expect(milestones).toHaveLength(2);
  });
});
