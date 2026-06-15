import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ExecutionForecaster } from "@arely/engine/llm/execution-forecaster.js";
import { ExecutionGate } from "@arely/engine/llm/execution-gate.js";
import { GoalUtilityScorer } from "@arely/engine/llm/goal-utility-scorer.js";
import {
  createGoal,
  createGoalPlan,
  createMilestone,
} from "@arely/persistence";
import { initTestDb, cleanupTestDb } from "../setup.js";

describe("Goal Forecast Flow", () => {
  let forecaster: ExecutionForecaster;
  let scorer: GoalUtilityScorer;

  beforeEach(() => {
    initTestDb();
    forecaster = new ExecutionForecaster(
      (strategy) => ({ research_first: 0.91, oneshot: 0.80, optimized: 0.98 })[strategy] ?? 0.5,
      (model, _provider, _taskType) => ({ "deepseek-r1": 0.93, "gpt-4o": 0.88, "gpt-5": 0.97 })[model] ?? 0.5,
    );
    scorer = new GoalUtilityScorer();
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should produce a GoalForecast from a PlanningContext via forecaster", () => {
    const goal = createGoal({ id: "g1", title: "Build Feature", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "Phase 1", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "Schema" });
    createMilestone({ id: "ms2", planId: plan.id, description: "Store" });

    const ctx = {
      taskType: "coding" as const,
      strategy: "research_first" as const,
      provider: "ollama",
      model: "deepseek-r1",
      estimatedTokens: 500,
      needsTools: true,
      toolNames: ["websearch"],
    };

    const prediction = forecaster.predict(ctx);
    const forecast = scorer.score({ goalId: "g1", milestoneId: "ms1", prediction });

    expect(forecast.goalId).toBe("g1");
    expect(forecast.predictedSuccessPct).toBeGreaterThan(0);
    expect(forecast.currentProgressPct).toBe(0);
    expect(forecast.predictedProgressGainPct).toBeGreaterThan(0);
    expect(forecast.expectedUtility).toBeGreaterThan(0);
    expect(forecast.confidence).toBeGreaterThan(0);
    expect(forecast.rationale.length).toBeGreaterThan(10);
  });

  it("should produce forecastGoalUtility via forecaster convenience method", () => {
    const goal = createGoal({ id: "g1", title: "Goal", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "A" });

    const prediction = forecaster.predict({
      taskType: "cheap",
      strategy: "optimized",
      provider: "openai",
      model: "gpt-5",
      estimatedTokens: 100,
      needsTools: false,
      toolNames: [],
    });

    const forecast = forecaster.forecastGoalUtility({
      goalId: "g1",
      milestoneId: "ms1",
      prediction,
    });

    expect(forecast.expectedUtility).toBeGreaterThan(0);
  });

  it("should reflect updated progress in utility", () => {
    const goal = createGoal({ id: "g1", title: "Goal", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "A" });

    const prediction = forecaster.predict({
      taskType: "cheap",
      strategy: "optimized",
      provider: "openai",
      model: "gpt-5",
      estimatedTokens: 100,
      needsTools: false,
      toolNames: [],
    });

    const before = scorer.scoreGoal("g1", prediction);
    expect(before.currentProgressPct).toBe(0);
    expect(before.predictedProgressGainPct).toBeGreaterThan(0);

    createGoalPlan({ id: "p2", goalId: goal.id, title: "P2", description: "d", progressPct: 50 });
    const afterBeforePlan = scorer.scoreGoal("g1", prediction);
    expect(afterBeforePlan.currentProgressPct).toBe(25);
  });

  it("should support weighted milestones", () => {
    const goal = createGoal({ id: "g1", title: "Goal", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "Big", weight: 3 });
    createMilestone({ id: "ms2", planId: plan.id, description: "Small", weight: 1 });

    const prediction = forecaster.predict({
      taskType: "cheap",
      strategy: "optimized",
      provider: "openai",
      model: "gpt-5",
      estimatedTokens: 100,
      needsTools: false,
      toolNames: [],
    });

    const big = scorer.score({ goalId: "g1", milestoneId: "ms1", prediction });
    const small = scorer.score({ goalId: "g1", milestoneId: "ms2", prediction });
    expect(big.predictedProgressGainPct).toBeGreaterThan(small.predictedProgressGainPct);
    expect(big.predictedProgressGainPct).toBe(75);
    expect(small.predictedProgressGainPct).toBe(25);
  });

  it("should allow gate to consider utility alongside probability", () => {
    const gate = new ExecutionGate({ budgetUsd: 0.05, lowThreshold: 0.85, mediumThreshold: 0.60, catastrophicThreshold: 0.30 });

    const goal = createGoal({ id: "g1", title: "Goal", description: "d" });
    const plan = createGoalPlan({ id: "p1", goalId: goal.id, title: "P1", description: "d" });
    createMilestone({ id: "ms1", planId: plan.id, description: "Critical", weight: 5 });

    const prediction = forecaster.predict({
      taskType: "coding",
      strategy: "research_first",
      provider: "ollama",
      model: "deepseek-r1",
      estimatedTokens: 500,
      needsTools: true,
      toolNames: ["websearch"],
    });

    const forecast = scorer.score({ goalId: "g1", milestoneId: "ms1", prediction });
    const gateAction = gate.decide(prediction);

    expect(forecast.expectedUtility).toBeGreaterThan(0);
    expect(gateAction.action).toBeDefined();
  });
});
