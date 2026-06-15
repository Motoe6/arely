import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ImprovementGoalGenerator } from "@arely/engine/llm/improvement-goal-generator.js";
import { getGoal, queryGoalPlans, queryMilestones } from "@arely/persistence";
import type { SelfAssessment } from "@arely/engine/llm/self-assessment-types.js";
import { initTestDb, cleanupTestDb } from "../setup.js";

describe("ImprovementGoalGenerator", () => {
  let generator: ImprovementGoalGenerator;

  beforeEach(() => {
    initTestDb();
    generator = new ImprovementGoalGenerator();
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should return empty result for empty assessment", () => {
    const assessment: SelfAssessment = { strengths: [], weaknesses: [], recommendations: [], summary: "" };
    const result = generator.generate(assessment);
    expect(result.totalCreated).toBe(0);
    expect(result.improvements).toHaveLength(0);
    expect(result.summary).toContain("No improvements generated");
  });

  it("should create a goal, plan, and 3 milestones for a strategy weakness recommendation", () => {
    const assessment: SelfAssessment = {
      strengths: [],
      weaknesses: [{ type: "weakness", dimension: "strategy", label: "research_first", metric: 0.25, threshold: 0.5, details: "1/4 (25%)" }],
      recommendations: [{ dimension: "strategy", label: "Improve research_first", description: "Strategy research_first has 25% success rate", expectedImpact: "Increase to 75%" }],
      summary: "",
    };

    const result = generator.generate(assessment);
    expect(result.totalCreated).toBe(1);

    const imp = result.improvements[0];
    expect(imp.dimension).toBe("strategy");
    expect(imp.recommendationLabel).toBe("Improve research_first");
    expect(imp.goal.title).toBe("Improve research_first");
    expect(imp.goal.status).toBe("active");
    expect(imp.goal.priority).toBe(5);
    expect(imp.plan.title).toBe("Improve research_first \u2014 Plan");
    expect(imp.plan.goalId).toBe(imp.goal.id);
    expect(imp.milestones).toHaveLength(3);
    expect(imp.milestones[0].status).toBe("pending");
    expect(imp.milestones[0].planId).toBe(imp.plan.id);
    expect(result.summary).toContain("Created 1 improvement goal");
  });

  it("should generate appropriate milestone descriptions per dimension", () => {
    const dims = ["strategy", "model", "prediction", "goal_progress", "reasoning"] as const;
    for (const dim of dims) {
      const assessment: SelfAssessment = {
        strengths: [],
        weaknesses: [{ type: "weakness", dimension: dim, label: `test_${dim}`, metric: 0.2, threshold: 0.5, details: `${dim} weakness` }],
        recommendations: [{ dimension: dim, label: `Fix ${dim}`, description: `Fix ${dim} weakness`, expectedImpact: "Improved" }],
        summary: "",
      };
      const result = generator.generate(assessment);
      expect(result.totalCreated).toBe(1);
      const ms = result.improvements[0].milestones;
      expect(ms).toHaveLength(3);
      for (const m of ms) {
        expect(m.description).toContain(`"Fix ${dim}"`);
      }
    }
  });

  it("should respect maxGoals option", () => {
    const recommendations = [
      { dimension: "strategy" as const, label: "Fix s1", description: "", expectedImpact: "" },
      { dimension: "strategy" as const, label: "Fix s2", description: "", expectedImpact: "" },
      { dimension: "strategy" as const, label: "Fix s3", description: "", expectedImpact: "" },
    ];
    const assessment: SelfAssessment = {
      strengths: [],
      weaknesses: recommendations.map((r) => ({ type: "weakness" as const, dimension: r.dimension, label: r.label, metric: 0.2, threshold: 0.5, details: "" })),
      recommendations,
      summary: "3 weaknesses",
    };

    const result = generator.generate(assessment, { maxGoals: 2 });
    expect(result.totalCreated).toBe(2);
    expect(result.improvements).toHaveLength(2);
    expect(result.improvements[0].recommendationLabel).toBe("Fix s1");
    expect(result.improvements[1].recommendationLabel).toBe("Fix s2");
  });

  it("should store source metadata on created goals", () => {
    const assessment: SelfAssessment = {
      strengths: [],
      weaknesses: [{ type: "weakness", dimension: "model", label: "gpt-4o/coding", metric: 0.4, threshold: 0.5, details: "" }],
      recommendations: [{ dimension: "model", label: "Improve gpt-4o/coding", description: "Model underperforms", expectedImpact: "Boost rate to 80%" }],
      summary: "",
    };

    const result = generator.generate(assessment);
    const goal = result.improvements[0].goal;
    expect(goal.metadata).toEqual({
      source: "self-assessment",
      dimension: "model",
      expectedImpact: "Boost rate to 80%",
    });
  });

  it("should persist all generated entities to the database", () => {
    const assessment: SelfAssessment = {
      strengths: [],
      weaknesses: [{ type: "weakness", dimension: "strategy", label: "bad_strat", metric: 0, threshold: 0.5, details: "0% success" }],
      recommendations: [{ dimension: "strategy", label: "Fix bad_strat", description: "Fix strategy", expectedImpact: "Higher success" }],
      summary: "",
    };

    const result = generator.generate(assessment);
    const { goal, plan, milestones } = result.improvements[0];

    const storedGoal = getGoal(goal.id);
    expect(storedGoal).toBeDefined();
    expect(storedGoal!.title).toBe("Fix bad_strat");

    const storedPlans = queryGoalPlans({ goalId: goal.id });
    expect(storedPlans).toHaveLength(1);
    expect(storedPlans[0].id).toBe(plan.id);

    const storedMilestones = queryMilestones({ planId: plan.id });
    expect(storedMilestones).toHaveLength(3);
    expect(storedMilestones.map((m) => m.id).sort()).toEqual(milestones.map((m) => m.id).sort());
  });

  it("should generate distinct entities for each recommendation", () => {
    const assessment: SelfAssessment = {
      strengths: [],
      weaknesses: [
        { type: "weakness", dimension: "strategy", label: "strat_a", metric: 0.2, threshold: 0.5, details: "" },
        { type: "weakness", dimension: "model", label: "model_b", metric: 0.3, threshold: 0.5, details: "" },
      ],
      recommendations: [
        { dimension: "strategy", label: "Fix strat_a", description: "Fix strategy A", expectedImpact: "A" },
        { dimension: "model", label: "Fix model_b", description: "Fix model B", expectedImpact: "B" },
      ],
      summary: "test",
    };

    const result = generator.generate(assessment);
    expect(result.totalCreated).toBe(2);

    const [first, second] = result.improvements;
    expect(first.goal.id).not.toBe(second.goal.id);
    expect(first.plan.id).not.toBe(second.plan.id);
    expect(first.milestones[0].id).not.toBe(second.milestones[0].id);
    expect(first.dimension).toBe("strategy");
    expect(second.dimension).toBe("model");
  });

  it("should handle unknown dimension by using reasoning milestones", () => {
    const assessment: SelfAssessment = {
      strengths: [],
      weaknesses: [{ type: "weakness", dimension: "reasoning", label: "some_reasoning", metric: 0.1, threshold: 0.5, details: "" }],
      recommendations: [{ dimension: "reasoning", label: "Fix reasoning", description: "Fix reasoning issues", expectedImpact: "Better" }],
      summary: "",
    };

    const result = generator.generate(assessment);
    expect(result.totalCreated).toBe(1);
    const ms = result.improvements[0].milestones;
    expect(ms).toHaveLength(3);
    expect(ms[0].description).toContain("Analyze reasoning failure patterns");
    expect(ms[1].description).toContain("Design improved reasoning approach");
    expect(ms[2].description).toContain("Test and validate reasoning improvements");
  });

  it("should set default description metadata on milestones", () => {
    const assessment: SelfAssessment = {
      strengths: [],
      weaknesses: [{ type: "weakness", dimension: "prediction", label: "bias_check", metric: 0.2, threshold: 0.5, details: "" }],
      recommendations: [{ dimension: "prediction", label: "Calibrate bias_check", description: "Calibrate prediction", expectedImpact: "Better accuracy" }],
      summary: "",
    };

    const result = generator.generate(assessment);
    const ms = result.improvements[0].milestones;
    expect(ms[0].description).toContain("Audit calibration data");
    expect(ms[1].description).toContain("Adjust prediction parameters");
    expect(ms[2].description).toContain("Validate improved calibration accuracy");
  });

  it("should generate a summary listing all created goals", () => {
    const assessment: SelfAssessment = {
      strengths: [],
      weaknesses: [
        { type: "weakness", dimension: "strategy", label: "s1", metric: 0.2, threshold: 0.5, details: "" },
        { type: "weakness", dimension: "model", label: "m1", metric: 0.3, threshold: 0.5, details: "" },
        { type: "weakness", dimension: "prediction", label: "p1", metric: -0.2, threshold: 0.15, details: "" },
      ],
      recommendations: [
        { dimension: "strategy", label: "Fix s1", description: "", expectedImpact: "" },
        { dimension: "model", label: "Fix m1", description: "", expectedImpact: "" },
        { dimension: "prediction", label: "Fix p1", description: "", expectedImpact: "" },
      ],
      summary: "",
    };

    const result = generator.generate(assessment);
    expect(result.totalCreated).toBe(3);
    expect(result.summary).toContain("Created 3 improvement goal(s)");
    expect(result.summary).toContain("Fix s1");
    expect(result.summary).toContain("Fix m1");
    expect(result.summary).toContain("Fix p1");
  });
});
