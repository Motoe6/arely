import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ImprovementPrioritizer } from "@arely/engine/llm/improvement-prioritizer.js";
import { GoalUtilityScorer } from "@arely/engine/llm/goal-utility-scorer.js";
import { createGoal, createGoalPlan, createMilestone, getMilestone } from "@arely/persistence";
import type { ImprovementGenerationResult, GeneratedImprovement } from "@arely/engine/llm/improvement-generator-types.js";
import { initTestDb, cleanupTestDb } from "../setup.js";

describe("ImprovementPrioritizer", () => {
  let prioritizer: ImprovementPrioritizer;
  let scorer: GoalUtilityScorer;

  beforeEach(() => {
    initTestDb();
    scorer = new GoalUtilityScorer();
    prioritizer = new ImprovementPrioritizer({ scorer });
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should return empty result for empty improvement result", () => {
    const result: ImprovementGenerationResult = { improvements: [], totalCreated: 0, summary: "" };
    const output = prioritizer.prioritize(result);
    expect(output.totalScored).toBe(0);
    expect(output.prioritized).toHaveLength(0);
    expect(output.summary).toContain("No improvements to prioritize");
  });

  it("should assign rank 1 to a single improvement", () => {
    const goal = createGoal({ id: "g1", title: "Fix strategy", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: "g1", title: "Plan", description: "d" });
    const ms = createMilestone({ id: "ms1", planId: "p1", description: "A" });
    const milestone = getMilestone("ms1")!;

    const result: ImprovementGenerationResult = {
      improvements: [{
        recommendationLabel: "Fix strategy",
        dimension: "strategy",
        goal,
        plan,
        milestones: [milestone],
      }],
      totalCreated: 1,
      summary: "",
    };

    const output = prioritizer.prioritize(result);
    expect(output.totalScored).toBe(1);
    expect(output.prioritized[0].rank).toBe(1);
    expect(output.prioritized[0].improvement.recommendationLabel).toBe("Fix strategy");
  });

  it("should rank improvements by expected utility descending", () => {
    const goalA = createGoal({ id: "ga", title: "Fix A (3 ms)", description: "d" });
    const planA = createGoalPlan({ id: "pa", goalId: "ga", title: "Plan A", description: "d" });
    const ma1 = createMilestone({ id: "ma1", planId: "pa", description: "A1" });
    const ma2 = createMilestone({ id: "ma2", planId: "pa", description: "A2" });
    const ma3 = createMilestone({ id: "ma3", planId: "pa", description: "A3" });

    const goalB = createGoal({ id: "gb", title: "Fix B (5 ms)", description: "d" });
    const planB = createGoalPlan({ id: "pb", goalId: "gb", title: "Plan B", description: "d" });
    const mb1 = createMilestone({ id: "mb1", planId: "pb", description: "B1" });
    const mb2 = createMilestone({ id: "mb2", planId: "pb", description: "B2" });
    const mb3 = createMilestone({ id: "mb3", planId: "pb", description: "B3" });
    const mb4 = createMilestone({ id: "mb4", planId: "pb", description: "B4" });
    const mb5 = createMilestone({ id: "mb5", planId: "pb", description: "B5" });

    const utilA = scorer.scoreGoal("ga", { successProbability: 0.5, expectedCostUsd: 0, expectedLatencyMs: 0, confidence: 0.5, risk: "medium", rationale: [] });
    const utilB = scorer.scoreGoal("gb", { successProbability: 0.5, expectedCostUsd: 0, expectedLatencyMs: 0, confidence: 0.5, risk: "medium", rationale: [] });

    expect(utilA.expectedUtility).toBeGreaterThan(utilB.expectedUtility);

    const result: ImprovementGenerationResult = {
      improvements: [
        {
          recommendationLabel: "Fix B (5 ms)",
          dimension: "model",
          goal: goalB,
          plan: planB,
          milestones: [mb1, mb2, mb3, mb4, mb5].map((ms) => getMilestone(ms.id)!),
        },
        {
          recommendationLabel: "Fix A (3 ms)",
          dimension: "strategy",
          goal: goalA,
          plan: planA,
          milestones: [ma1, ma2, ma3].map((ms) => getMilestone(ms.id)!),
        },
      ],
      totalCreated: 2,
      summary: "",
    };

    const output = prioritizer.prioritize(result);
    expect(output.totalScored).toBe(2);
    expect(output.prioritized[0].rank).toBe(1);
    expect(output.prioritized[0].improvement.recommendationLabel).toBe("Fix A (3 ms)");
    expect(output.prioritized[0].expectedUtility).toBe(utilA.expectedUtility);
    expect(output.prioritized[1].rank).toBe(2);
    expect(output.prioritized[1].improvement.recommendationLabel).toBe("Fix B (5 ms)");
    expect(output.prioritized[1].expectedUtility).toBe(utilB.expectedUtility);
  });

  it("should preserve insertion order for equal-utility improvements", () => {
    const goalA = createGoal({ id: "ga", title: "Fix A", description: "d" });
    const planA = createGoalPlan({ id: "pa", goalId: "ga", title: "Plan A", description: "d" });
    const ma1 = createMilestone({ id: "ma1", planId: "pa", description: "A1" });

    const goalB = createGoal({ id: "gb", title: "Fix B", description: "d" });
    const planB = createGoalPlan({ id: "pb", goalId: "gb", title: "Plan B", description: "d" });
    const mb1 = createMilestone({ id: "mb1", planId: "pb", description: "B1" });

    const result: ImprovementGenerationResult = {
      improvements: [
        {
          recommendationLabel: "Fix A", dimension: "strategy", goal: goalA, plan: planA,
          milestones: [getMilestone("ma1")!],
        },
        {
          recommendationLabel: "Fix B", dimension: "model", goal: goalB, plan: planB,
          milestones: [getMilestone("mb1")!],
        },
      ],
      totalCreated: 2,
      summary: "",
    };

    const output = prioritizer.prioritize(result);
    expect(output.prioritized[0].improvement.recommendationLabel).toBe("Fix A");
    expect(output.prioritized[1].improvement.recommendationLabel).toBe("Fix B");
  });

  it("should pass through forecast fields to the prioritized result", () => {
    const goal = createGoal({ id: "g1", title: "Fix model", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: "g1", title: "Plan", description: "d" });
    const ms = createMilestone({ id: "ms1", planId: "p1", description: "A" });

    const result: ImprovementGenerationResult = {
      improvements: [{
        recommendationLabel: "Fix model",
        dimension: "model",
        goal,
        plan,
        milestones: [getMilestone("ms1")!],
      }],
      totalCreated: 1,
      summary: "",
    };

    const output = prioritizer.prioritize(result);
    expect(output.prioritized[0].predictedProgressGainPct).toBeGreaterThan(0);
    expect(output.prioritized[0].predictedSuccessPct).toBe(50);
    expect(output.prioritized[0].confidence).toBe(0.5);
    expect(output.prioritized[0].expectedUtility).toBeGreaterThan(0);
  });

  it("should report partial progress in forecast for in-progress goals", () => {
    const goal = createGoal({ id: "g1", title: "Half done", description: "d", progressPct: 50 });
    const plan = createGoalPlan({ id: "p1", goalId: "g1", title: "Plan", description: "d", progressPct: 50 });
    const ms = createMilestone({ id: "ms1", planId: "p1", description: "A" });

    const result: ImprovementGenerationResult = {
      improvements: [{
        recommendationLabel: "Half done",
        dimension: "strategy",
        goal,
        plan,
        milestones: [getMilestone("ms1")!],
      }],
      totalCreated: 1,
      summary: "",
    };

    const output = prioritizer.prioritize(result);
    expect(output.prioritized[0].expectedUtility).toBeGreaterThanOrEqual(0);
  });

  it("should generate a summary with top-ranked improvement", () => {
    const goal = createGoal({ id: "g1", title: "Top priority", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: "g1", title: "Plan", description: "d" });
    const ms = createMilestone({ id: "ms1", planId: "p1", description: "A" });

    const result: ImprovementGenerationResult = {
      improvements: [{
        recommendationLabel: "Top priority",
        dimension: "strategy",
        goal,
        plan,
        milestones: [getMilestone("ms1")!],
      }],
      totalCreated: 1,
      summary: "",
    };

    const output = prioritizer.prioritize(result);
    expect(output.summary).toContain("Prioritized 1 improvement(s)");
    expect(output.summary).toContain("Top priority");
    expect(output.summary).toContain("utility=");
  });
});
