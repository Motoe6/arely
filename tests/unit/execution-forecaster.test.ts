import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ExecutionForecaster } from "@arelyos/engine/llm/execution-forecaster.js";
import { initTestDb, cleanupTestDb } from "../setup.js";

describe("ExecutionForecaster", () => {
  let forecaster: ExecutionForecaster;

  beforeEach(() => {
    initTestDb();
    forecaster = new ExecutionForecaster(
      (strategy) => ({ research_first: 0.91, oneshot: 0.80, optimized: 0.98 })[strategy] ?? 0.5,
      (model, _provider, _taskType) => ({ "deepseek-r1": 0.93, "gpt-4o": 0.88, "gpt-5": 0.97 })[model] ?? 0.5,
    );
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should compute success probability from all factors", () => {
    const result = forecaster.predict({
      taskType: "coding",
      strategy: "research_first",
      provider: "ollama",
      model: "deepseek-r1",
      estimatedTokens: 500,
      needsTools: true,
      toolNames: ["websearch"],
    });

    expect(result.successProbability).toBeGreaterThan(0);
    expect(result.successProbability).toBeLessThanOrEqual(1);
    expect(result.rationale.length).toBeGreaterThanOrEqual(4);
  });

  it("should return low risk for high probability", () => {
    const result = forecaster.predict({
      taskType: "cheap",
      strategy: "optimized",
      provider: "openai",
      model: "gpt-5",
      estimatedTokens: 50,
      needsTools: false,
      toolNames: [],
    });

    expect(result.successProbability).toBeGreaterThanOrEqual(0.85);
    expect(result.risk).toBe("low");
  });

  it("should return medium risk for moderate probability", () => {
    const result = forecaster.predict({
      taskType: "research",
      strategy: "research_first",
      provider: "ollama",
      model: "deepseek-r1",
      estimatedTokens: 1000,
      needsTools: false,
      toolNames: [],
    });

    const p = result.successProbability;
    expect(p).toBeGreaterThanOrEqual(0.60);
    expect(p).toBeLessThan(0.85);
    expect(result.risk).toBe("medium");
  });

  it("should return high risk for low probability", () => {
    const result = forecaster.predict({
      taskType: "agentic",
      strategy: "unknown",
      provider: "ollama",
      model: "unknown",
      estimatedTokens: 5000,
      needsTools: true,
      toolNames: ["unknown_tool"],
    });

    expect(result.successProbability).toBeLessThan(0.60);
    expect(result.risk).toBe("high");
  });

  it("should estimate cost proportional to tokens", () => {
    const small = forecaster.predict({
      taskType: "conversation", strategy: "oneshot", provider: "openai", model: "gpt-4o",
      estimatedTokens: 100, needsTools: false, toolNames: [],
    });
    const large = forecaster.predict({
      taskType: "conversation", strategy: "oneshot", provider: "openai", model: "gpt-4o",
      estimatedTokens: 10000, needsTools: false, toolNames: [],
    });

    expect(large.expectedCostUsd).toBeGreaterThan(small.expectedCostUsd);
  });

  it("should estimate latency proportional to tokens and tools", () => {
    const noTools = forecaster.predict({
      taskType: "conversation", strategy: "oneshot", provider: "openai", model: "gpt-4o",
      estimatedTokens: 1000, needsTools: false, toolNames: [],
    });
    const withTools = forecaster.predict({
      taskType: "coding", strategy: "oneshot", provider: "openai", model: "gpt-4o",
      estimatedTokens: 1000, needsTools: true, toolNames: ["websearch"],
    });

    expect(withTools.expectedLatencyMs).toBeGreaterThan(noTools.expectedLatencyMs);
  });

  it("should include all factors in rationale", () => {
    const result = forecaster.predict({
      taskType: "coding", strategy: "research_first", provider: "ollama", model: "deepseek-r1",
      estimatedTokens: 500, needsTools: true, toolNames: ["websearch"],
    });

    expect(result.rationale.some((r) => r.includes("research_first"))).toBe(true);
    expect(result.rationale.some((r) => r.includes("deepseek-r1"))).toBe(true);
    expect(result.rationale.some((r) => r.includes("complexity"))).toBe(true);
  });

  it("should apply complexity penalty per task type", () => {
    const cheap = forecaster.predict({
      taskType: "cheap", strategy: "oneshot", provider: "openai", model: "gpt-4o",
      estimatedTokens: 100, needsTools: false, toolNames: [],
    });
    const agentic = forecaster.predict({
      taskType: "agentic", strategy: "oneshot", provider: "openai", model: "gpt-4o",
      estimatedTokens: 100, needsTools: false, toolNames: [],
    });

    expect(cheap.successProbability).toBeGreaterThan(agentic.successProbability);
  });

  it("should produce deterministic results for same input", () => {
    const ctx = {
      taskType: "coding" as const, strategy: "research_first", provider: "ollama", model: "deepseek-r1",
      estimatedTokens: 500, needsTools: true, toolNames: ["websearch"],
    };

    const a = forecaster.predict(ctx);
    const b = forecaster.predict(ctx);

    expect(a.successProbability).toBe(b.successProbability);
    expect(a.risk).toBe(b.risk);
    expect(a.rationale).toEqual(b.rationale);
  });
});
