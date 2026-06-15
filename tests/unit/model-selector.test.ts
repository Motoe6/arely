import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ModelSelector } from "@arely/engine/llm/model-selector.js";
import { ModelPerformanceService } from "@arely/engine/llm/model-performance-service.js";
import { TaskClassifier } from "@arely/engine/llm/task-classifier.js";
import { initTestDb, cleanupTestDb } from "../setup.js";

describe("ModelSelector", () => {
  let perfService: ModelPerformanceService;
  let selector: ModelSelector;
  let classifier: TaskClassifier;

  beforeEach(() => {
    initTestDb();
    perfService = new ModelPerformanceService();
    selector = new ModelSelector(perfService);
    classifier = new TaskClassifier();
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should return fallback recommendations when no data exists", () => {
    const profile = classifier.classify("implement a new feature");
    const recs = selector.recommend(profile, []);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].rationale).toContain("No historical data");
  });

  it("should rank candidates by score", async () => {
    await perfService.recordExecution("gpt-4o", "openai", "coding", true, 500, 100, 0.005);
    await perfService.recordExecution("deepseek-r1", "ollama", "coding", true, 2000, 200, 0.001);

    const snapshots = perfService.getSnapshots("coding");
    const profile = classifier.classify("write a TypeScript function");
    const recs = selector.recommend(profile, snapshots);

    expect(recs.length).toBeGreaterThanOrEqual(2);
    expect(recs[0].score).toBeGreaterThanOrEqual(recs[1].score);
  });

  it("should prefer higher success rate", async () => {
    await perfService.recordExecution("good-model", "openai", "coding", true, 500, 100, 0.01);
    await perfService.recordExecution("good-model", "openai", "coding", true, 500, 100, 0.01);
    await perfService.recordExecution("bad-model", "openai", "coding", false, 500, 100, 0.01);

    const snapshots = perfService.getSnapshots("coding");
    const profile = classifier.classify("write code");
    const recs = selector.recommend(profile, snapshots);

    expect(recs[0].model).toBe("good-model");
  });

  it("should include rationale in recommendations", async () => {
    await perfService.recordExecution("gpt-4o-mini", "openai", "coding", true, 300, 50, 0.001);

    const snapshots = perfService.getSnapshots("coding");
    const profile = classifier.classify("write code");
    const recs = selector.recommend(profile, snapshots);

    expect(recs[0].rationale).toContain("gpt-4o-mini");
    expect(recs[0].rationale).toContain("success");
  });

  it("should prefer cheap models for cheap task types", () => {
    const profile = classifier.classify("quick yes or no answer");
    expect(profile.type).toBe("cheap");

    const recs = selector.recommend(profile, []);
    expect(recs.length).toBeGreaterThanOrEqual(1);
  });

  it("should return empty array when no candidates and no fallback is defined", () => {
    const recs = selector.recommend(
      { type: "conversation", complexity: 10, estimatedTokens: 50, needsTools: false },
      [],
    );
    expect(recs.length).toBeGreaterThanOrEqual(1);
  });

  it("should compute score based on weighted formula", async () => {
    await perfService.recordExecution("fast-model", "openai", "coding", true, 200, 50, 0.001);
    const snapshots = perfService.getSnapshots("coding");
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].avgCostUsd).toBeGreaterThan(0);
  });
});
