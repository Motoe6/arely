import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SelfAssessmentService } from "@arely/engine/llm/self-assessment-service.js";
import { PredictionCalibrator } from "@arely/engine/llm/prediction-calibrator.js";
import { createDecision, createGoal, createSession } from "@arely/persistence";
import { modelPerformanceService } from "@arely/engine/llm/model-performance-service.js";
import { initTestDb, cleanupTestDb } from "../setup.js";

describe("SelfAssessmentService", () => {
  let service: SelfAssessmentService;
  let calibrator: PredictionCalibrator;

  beforeEach(() => {
    initTestDb();
    calibrator = new PredictionCalibrator();
    service = new SelfAssessmentService({ calibrator });
    createSession({ id: "s1", query: "test", model: "gpt-4o", toolMode: "native" });
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should return empty assessment when no data exists", () => {
    const result = service.assess();
    expect(result.strengths).toHaveLength(0);
    expect(result.weaknesses).toHaveLength(0);
    expect(result.recommendations).toHaveLength(0);
    expect(result.summary).toBe("");
  });

  it("should identify a strategy strength", () => {
    for (let i = 0; i < 5; i++) {
      createDecision({
        id: `d-s${i}`,
        sessionId: "s1",
        decisionType: "coding",
        decision: `use research_first #${i}`,
        rationale: "r",
        outcome: i < 4 ? "success" : "failure",
        metadata: { strategy: "research_first" },
      });
    }

    const result = service.assess();
    const rf = result.strengths.find((s) => s.label === "research_first");
    expect(rf).toBeDefined();
    expect(rf!.type).toBe("strength");
    expect(rf!.dimension).toBe("strategy");
    expect(rf!.metric).toBeCloseTo(0.8);
  });

  it("should identify a strategy weakness", () => {
    for (let i = 0; i < 4; i++) {
      createDecision({
        id: `d-w${i}`,
        sessionId: "s1",
        decisionType: "coding",
        decision: `use template_driven #${i}`,
        rationale: "r",
        outcome: i < 1 ? "success" : "failure",
        metadata: { strategy: "template_driven" },
      });
    }

    const result = service.assess();
    const td = result.weaknesses.find((w) => w.label === "template_driven");
    expect(td).toBeDefined();
    expect(td!.type).toBe("weakness");
    expect(td!.dimension).toBe("strategy");
    expect(td!.metric).toBeCloseTo(0.25);
  });

  it("should not classify strategies with too few observations", () => {
    createDecision({
      id: "d-only",
      sessionId: "s1",
      decisionType: "test",
      decision: "use oneshot",
      rationale: "r",
      outcome: "success",
      metadata: { strategy: "oneshot" },
    });

    const result = service.assess();
    expect(result.strengths).toHaveLength(0);
    expect(result.weaknesses).toHaveLength(0);
  });

  it("should identify a model strength via performance service", async () => {
    await modelPerformanceService.recordExecution("gpt-5", "openai", "coding", true, 100, 50, 0.001);
    await modelPerformanceService.recordExecution("gpt-5", "openai", "coding", true, 200, 100, 0.002);
    await modelPerformanceService.recordExecution("gpt-5", "openai", "coding", true, 150, 75, 0.0015);
    await modelPerformanceService.recordExecution("gpt-5", "openai", "coding", true, 180, 90, 0.0018);

    const result = service.assess();
    const ms = result.strengths.find((s) => s.label.startsWith("gpt-5"));
    expect(ms).toBeDefined();
    expect(ms!.type).toBe("strength");
    expect(ms!.dimension).toBe("model");
  });

  it("should identify a model weakness via performance service", async () => {
    for (let i = 0; i < 4; i++) {
      await modelPerformanceService.recordExecution("deepseek-r1", "ollama", "coding", i < 1, 500, 200, 0.01);
    }

    const result = service.assess();
    const mw = result.weaknesses.find((w) => w.label.startsWith("deepseek-r1"));
    expect(mw).toBeDefined();
    expect(mw!.type).toBe("weakness");
    expect(mw!.dimension).toBe("model");
  });

  it("should detect prediction bias as a weakness", () => {
    calibrator.recordForecast(
      { successProbability: 0.9, expectedCostUsd: 0, expectedLatencyMs: 0, confidence: 0.8, risk: "low", rationale: [] },
      false,
      { taskType: "coding", strategy: "research_first", provider: "openai", model: "gpt-4o" },
    );
    calibrator.recordForecast(
      { successProbability: 0.85, expectedCostUsd: 0, expectedLatencyMs: 0, confidence: 0.7, risk: "low", rationale: [] },
      false,
      { taskType: "coding", strategy: "research_first", provider: "openai", model: "gpt-4o" },
    );
    calibrator.recordForecast(
      { successProbability: 0.95, expectedCostUsd: 0, expectedLatencyMs: 0, confidence: 0.9, risk: "low", rationale: [] },
      false,
      { taskType: "coding", strategy: "research_first", provider: "openai", model: "gpt-4o" },
    );

    const result = service.assess();
    const bias = result.weaknesses.find((w) => w.dimension === "prediction");
    expect(bias).toBeDefined();
    expect(bias!.details).toContain("overconfident");
  });

  it("should detect stalled goals as weaknesses", () => {
    createGoal({ id: "g1", title: "Unstarted Feature", description: "d" });

    const result = service.assess();
    const stalled = result.weaknesses.find((w) => w.dimension === "goal_progress");
    expect(stalled).toBeDefined();
    expect(stalled!.label).toBe("Unstarted Feature");
  });

  it("should ignore goals with progress > 0", () => {
    createGoal({ id: "g1", title: "In Progress", description: "d", progressPct: 50 });

    const result = service.assess();
    const stalled = result.weaknesses.find((w) => w.dimension === "goal_progress");
    expect(stalled).toBeUndefined();
  });

  it("should generate recommendations matching each weakness", () => {
    for (let i = 0; i < 4; i++) {
      createDecision({
        id: `d-r${i}`,
        sessionId: "s1",
        decisionType: "coding",
        decision: `use bad_strat #${i}`,
        rationale: "r",
        outcome: "failure",
        metadata: { strategy: "bad_strat" },
      });
    }
    createGoal({ id: "g1", title: "Stuck Goal", description: "d" });

    const result = service.assess();
    expect(result.weaknesses.length).toBeGreaterThanOrEqual(1);
    expect(result.recommendations.length).toBe(result.weaknesses.length);
    expect(result.recommendations[0].dimension).toBeDefined();
    expect(result.recommendations[0].label).toBeDefined();
    expect(result.recommendations[0].description).toBeDefined();
    expect(result.recommendations[0].expectedImpact).toBeDefined();
  });

  it("should generate a non-empty summary with data present", () => {
    for (let i = 0; i < 5; i++) {
      createDecision({
        id: `d-sum${i}`,
        sessionId: "s1",
        decisionType: "coding",
        decision: `use good_strat #${i}`,
        rationale: "r",
        outcome: i < 4 ? "success" : "failure",
        metadata: { strategy: "good_strat" },
      });
    }

    const result = service.assess();
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary).toContain("Strengths:");
    expect(result.summary).toContain("good_strat");
  });

  it("should handle mixed strengths and weaknesses", () => {
    for (let i = 0; i < 5; i++) {
      createDecision({
        id: `d-ms${i}`,
        sessionId: "s1",
        decisionType: "coding",
        decision: `use good #${i}`,
        rationale: "r",
        outcome: i < 4 ? "success" : "failure",
        metadata: { strategy: "strong_strat" },
      });
    }
    for (let i = 0; i < 4; i++) {
      createDecision({
        id: `d-mw${i}`,
        sessionId: "s1",
        decisionType: "coding",
        decision: `use bad #${i}`,
        rationale: "r",
        outcome: "failure",
        metadata: { strategy: "weak_strat" },
      });
    }

    const result = service.assess();

    expect(result.strengths.some((s) => s.label === "strong_strat")).toBe(true);
    expect(result.weaknesses.some((w) => w.label === "weak_strat")).toBe(true);
    expect(result.recommendations.some((r) => r.label.includes("weak_strat"))).toBe(true);
  });

  it("should skip incomplete prediction calibrations (too few obs)", () => {
    calibrator.recordForecast(
      { successProbability: 0.9, expectedCostUsd: 0, expectedLatencyMs: 0, confidence: 0.8, risk: "low", rationale: [] },
      false,
      { taskType: "coding", strategy: "research_first", provider: "openai", model: "gpt-4o" },
    );

    const result = service.assess();
    const bias = result.weaknesses.find((w) => w.dimension === "prediction");
    expect(bias).toBeUndefined();
  });
});
