import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GoalUtilityScorer } from "@arelyos/engine/llm/goal-utility-scorer.js";
import type { ExecutionPrediction } from "@arelyos/engine/llm/prediction-types.js";
import {
  createGoal,
  createGoalPlan,
  createMilestone,
} from "@arelyos/persistence";
import { initTestDb, cleanupTestDb } from "../setup.js";

describe("GoalUtilityScorer", () => {
  let scorer: GoalUtilityScorer;
  const basePrediction: ExecutionPrediction = {
    successProbability: 0.65,
    expectedCostUsd: 0.01,
    expectedLatencyMs: 500,
    confidence: 0.7,
    risk: "medium",
    rationale: ["test"],
  };

  beforeEach(() => {
    initTestDb();
    scorer = new GoalUtilityScorer();
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should return zero utility for nonexistent goal", () => {
    const result = scorer.scoreGoal("nonexistent", basePrediction);
    expect(result.expectedUtility).toBe(0);
    expect(result.predictedProgressGainPct).toBe(0);
    expect(result.rationale).toBe("Goal not found");
  });

  it("should compute utility = P(success) x gain with equal weights", () => {
    const goal = createGoal({ id: "g1", title: "Test", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "A" });
    createMilestone({ id: "ms2", planId: plan.id, description: "B" });
    createMilestone({ id: "ms3", planId: plan.id, description: "C" });

    const result = scorer.scoreGoal("g1", { ...basePrediction, successProbability: 0.65 });
    expect(result.currentProgressPct).toBe(0);
    expect(result.predictedProgressGainPct).toBeGreaterThan(0);
    expect(result.expectedUtility).toBeGreaterThan(0);
  });

  it("should compute utility=0 when P(success)=0", () => {
    const goal = createGoal({ id: "g1", title: "Test", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "A" });

    const result = scorer.scoreGoal("g1", { ...basePrediction, successProbability: 0 });
    expect(result.expectedUtility).toBe(0);
    expect(result.predictedSuccessPct).toBe(0);
  });

  it("should compute utility=0 when gain=0 (no milestones)", () => {
    const goal = createGoal({ id: "g1", title: "Test", description: "d" });
    createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d" });

    const result = scorer.scoreGoal("g1", basePrediction);
    expect(result.expectedUtility).toBe(0);
    expect(result.predictedProgressGainPct).toBe(0);
  });

  it("should return utility for a specific milestone via context", () => {
    const goal = createGoal({ id: "g1", title: "Test", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "A" });
    createMilestone({ id: "ms2", planId: plan.id, description: "B" });

    const result = scorer.score({
      goalId: "g1",
      milestoneId: "ms1",
      prediction: basePrediction,
    });
    expect(result.predictedProgressGainPct).toBeGreaterThan(0);
    expect(result.expectedUtility).toBeGreaterThan(0);
    expect(result.confidence).toBe(0.7);
  });

  it("should respect milestone weights", () => {
    const goal = createGoal({ id: "g1", title: "Test", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "Heavy", weight: 3 });
    createMilestone({ id: "ms2", planId: plan.id, description: "Light", weight: 1 });

    const heavy = scorer.score({ goalId: "g1", milestoneId: "ms1", prediction: basePrediction });
    const light = scorer.score({ goalId: "g1", milestoneId: "ms2", prediction: basePrediction });
    expect(heavy.predictedProgressGainPct).toBeGreaterThan(light.predictedProgressGainPct);
  });

  it("should handle multiple goals independently", () => {
    const g1 = createGoal({ id: "g1", title: "Goal 1", description: "d" });
    const g2 = createGoal({ id: "g2", title: "Goal 2", description: "d" });
    const p1 = createGoalPlan({ id: "p1", goalId: g1.id, title: "P1", description: "d" });
    const p2 = createGoalPlan({ id: "p2", goalId: g2.id, title: "P2", description: "d" });
    createMilestone({ id: "ms1", planId: p1.id, description: "A" });
    createMilestone({ id: "ms2", planId: p2.id, description: "B" });

    const r1 = scorer.scoreGoal("g1", basePrediction);
    const r2 = scorer.scoreGoal("g2", basePrediction);
    expect(r1.goalId).toBe("g1");
    expect(r2.goalId).toBe("g2");
    expect(r1.expectedUtility).toBeGreaterThan(0);
    expect(r2.expectedUtility).toBeGreaterThan(0);
  });

  it("should return zero gain for completed goals", () => {
    const goal = createGoal({ id: "g1", title: "Done", description: "d", status: "completed", progressPct: 100 });
    createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d", progressPct: 100, status: "completed" });

    const result = scorer.scoreGoal("g1", basePrediction);
    expect(result.currentProgressPct).toBe(100);
  });

  it("should propagate confidence from prediction", () => {
    const goal = createGoal({ id: "g1", title: "Test", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "A" });

    const result = scorer.scoreGoal("g1", { ...basePrediction, confidence: 0.95 });
    expect(result.confidence).toBe(0.95);
  });

  it("should generate rationale text", () => {
    const goal = createGoal({ id: "g1", title: "Test", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "A" });

    const result = scorer.scoreGoal("g1", basePrediction);
    expect(result.rationale.length).toBeGreaterThan(10);
    expect(result.rationale).toContain("Utility");
  });

  it("should round predictedSuccessPct", () => {
    const goal = createGoal({ id: "g1", title: "Test", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "A" });

    const result = scorer.scoreGoal("g1", { ...basePrediction, successProbability: 0.33333 });
    expect(result.predictedSuccessPct).toBe(33);
  });

  it("should work with planId context (no milestone)", () => {
    const goal = createGoal({ id: "g1", title: "Test", description: "d" });
    createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d" });
    createGoalPlan({ id: "p2", goalId: goal.id, title: "P2", description: "d" });

    const result = scorer.score({
      goalId: "g1",
      planId: "p1",
      prediction: basePrediction,
    });
    expect(result.expectedUtility).toBeGreaterThanOrEqual(0);
    expect(result.goalId).toBe("g1");
  });

  it("should handle goals with partial progress", () => {
    const goal = createGoal({ id: "g1", title: "Partial", description: "d", progressPct: 60 });
    createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d", progressPct: 60 });
    createMilestone({ id: "ms1", planId: "p1", description: "A" });

    const result = scorer.scoreGoal("g1", basePrediction);
    expect(result.currentProgressPct).toBe(60);
  });
});
