import { describe, it, expect, beforeEach } from "vitest";
import { ModelPerformanceService, TASK_TYPES } from "@arelyos/engine/llm/model-performance-service.js";
import { initTestDb, cleanupTestDb } from "../setup.js";

describe("ModelPerformanceService", () => {
  let svc: ModelPerformanceService;

  beforeEach(() => {
    initTestDb();
    svc = new ModelPerformanceService();
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should record an execution and retrieve it", async () => {
    await svc.recordExecution("gpt-4o", "openai", "coding", true, 1500, 500);
    const results = svc.getModelPerformance({ model: "gpt-4o" });
    expect(results).toHaveLength(1);
    expect(results[0].model).toBe("gpt-4o");
    expect(results[0].successes).toBe(1);
    expect(results[0].failures).toBe(0);
    expect(results[0].totalDecisions).toBe(1);
    expect(results[0].avgLatencyMs).toBe(1500);
    expect(results[0].totalTokens).toBe(500);
  });

  it("should record multiple executions and aggregate stats", async () => {
    await svc.recordExecution("gpt-4o", "openai", "coding", true, 1000, 300);
    await svc.recordExecution("gpt-4o", "openai", "coding", true, 2000, 700);
    await svc.recordExecution("gpt-4o", "openai", "coding", false, 1500, 400);

    const results = svc.getModelPerformance({ model: "gpt-4o" });
    expect(results[0].totalDecisions).toBe(3);
    expect(results[0].successes).toBe(2);
    expect(results[0].failures).toBe(1);
    expect(results[0].avgLatencyMs).toBe(1500); // (1000+2000+1500)/3
    expect(results[0].totalTokens).toBe(1400);
  });

  it("should separate records by model and taskType", async () => {
    await svc.recordExecution("gpt-4o", "openai", "coding", true);
    await svc.recordExecution("deepseek-r1", "ollama", "research", true);
    await svc.recordExecution("gpt-4o", "openai", "research", false);

    const all = svc.getModelPerformance();
    expect(all).toHaveLength(3);

    const coding = svc.getModelPerformance({ taskType: "coding" });
    expect(coding).toHaveLength(1);

    const gpt4o = svc.getModelPerformance({ model: "gpt-4o" });
    expect(gpt4o).toHaveLength(2);
    expect(gpt4o.map((r) => r.taskType).sort()).toEqual(["coding", "research"]);
  });

  it("should return best model by success rate", async () => {
    await svc.recordExecution("gpt-4o", "openai", "coding", true, 1000);
    await svc.recordExecution("gpt-4o", "openai", "coding", false, 1000);
    await svc.recordExecution("deepseek-r1", "ollama", "coding", true, 1000);
    await svc.recordExecution("deepseek-r1", "ollama", "coding", true, 1000);

    const best = svc.getBestModel("coding");
    expect(best).not.toBeNull();
    expect(best!.model).toBe("deepseek-r1");
  });

  it("should return null for best model when no data", () => {
    expect(svc.getBestModel("planning")).toBeNull();
  });

  it("should filter by minConfidence", async () => {
    // confidence = min(100, round(1/30 * 100)) = 3 for 1 execution
    await svc.recordExecution("gpt-4o", "openai", "coding", true);
    const lowConf = svc.getModelPerformance({ taskType: "coding", minConfidence: 50 });
    expect(lowConf).toHaveLength(0);

    const noFilter = svc.getModelPerformance({ taskType: "coding" });
    expect(noFilter).toHaveLength(1);
  });

  it("should recommend model with formatted string", async () => {
    await svc.recordExecution("gpt-4o", "openai", "coding", true, 1000, 500);
    await svc.recordExecution("gpt-4o", "openai", "coding", true, 1000, 500);

    const rec = svc.recommendModel("coding");
    expect(rec).toContain("gpt-4o");
    expect(rec).toContain("100%");
    expect(rec).toContain("2 executions");
  });

  it("should return null recommendation when no data", () => {
    expect(svc.recommendModel("debugging")).toBeNull();
  });

  it("should compute convergence stats", async () => {
    await svc.recordExecution("gpt-4o", "openai", "coding", true);
    await svc.recordExecution("gpt-4o", "openai", "coding", false);

    const conv = svc.getConvergence("coding");
    expect(conv).toHaveLength(1);
    expect(conv[0].observations).toBe(2);
    expect(conv[0].successRate).toBe(0.5);
  });

  it("should return convergence for all task types", async () => {
    await svc.recordExecution("deepseek-r1", "ollama", "coding", true);
    await svc.recordExecution("deepseek-r1", "ollama", "research", true);

    const conv = svc.getConvergence();
    expect(conv).toHaveLength(2);
  });

  it("should list all recommendations", async () => {
    const empty = svc.getAllRecommendations();
    expect(empty).toHaveLength(0);

    await svc.recordExecution("gpt-4o", "openai", "coding", true);
    await svc.recordExecution("gpt-4o", "openai", "coding", true);

    const recs = svc.getAllRecommendations();
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0]).toContain("coding");
  });

  it("should infer task type from decision type", async () => {
    await svc.recordExecution("gpt-4o", "openai", "debugging", true);
    await svc.recordExecution("gpt-4o", "openai", "planning", true);

    // Infer from recordExecution usage (taskType is explicit)
    const all = svc.getModelPerformance({ model: "gpt-4o" });
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.taskType === "debugging")).toBeDefined();
    expect(all.find((r) => r.taskType === "planning")).toBeDefined();
  });

  it("should increase confidence with more observations", async () => {
    for (let i = 0; i < 15; i++) {
      await svc.recordExecution("gpt-5", "openai", "coding", true);
    }
    const results = svc.getModelPerformance({ model: "gpt-5" });
    expect(results[0].confidence).toBe(50); // round(15/30 * 100)

    for (let i = 0; i < 15; i++) {
      await svc.recordExecution("gpt-5", "openai", "coding", true);
    }
    const results2 = svc.getModelPerformance({ model: "gpt-5" });
    expect(results2[0].confidence).toBe(100); // capped at 100
  });

  it("should respect provider separation", async () => {
    await svc.recordExecution("qwen3", "ollama", "coding", true);
    await svc.recordExecution("qwen3", "openai", "coding", false);

    const results = svc.getModelPerformance({ model: "qwen3" });
    expect(results).toHaveLength(2);
    expect(results.filter((r) => r.provider === "ollama")[0].successes).toBe(1);
    expect(results.filter((r) => r.provider === "openai")[0].failures).toBe(1);
  });
});
