import { describe, it, expect, beforeEach, vi } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createSession } from "../../packages/engine/src/persistence/session-store.js";

vi.mock("../../packages/engine/src/config/index.js", () => ({
  getConfig: vi.fn(() => ({})),
}));

function makeSession(id: string): void {
  createSession({ id, query: id, model: "test", toolMode: "native" });
}

describe("StrategyEvaluator", () => {
  beforeEach(() => {
    initTestDb();
  });

  afterEach(() => {
    cleanupTestDb();
    vi.restoreAllMocks();
  });

  it("returns empty array when no decisions have strategy metadata", async () => {
    const { StrategyEvaluator } = await import("../../packages/engine/src/llm/strategy-evaluator.js");
    const evaluator = new StrategyEvaluator();
    const result = await evaluator.getStrategyPerformance("nonexistent");
    expect(result).toEqual([]);
  });

  it("returns empty string from buildStrategyContext when no data", async () => {
    const { StrategyEvaluator } = await import("../../packages/engine/src/llm/strategy-evaluator.js");
    const evaluator = new StrategyEvaluator();
    const ctx = await evaluator.buildStrategyContext("nonexistent");
    expect(ctx).toBe("");
  });

  it("groups decisions by strategy name and calculates success rates", async () => {
    makeSession("session-1");
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");
    const { StrategyEvaluator } = await import("../../packages/engine/src/llm/strategy-evaluator.js");

    const d1 = await decisionService.logDecision({
      sessionId: "session-1", decisionType: "websearch", decision: "search 1", rationale: "test",
      metadata: { strategy: "research_first" },
    });
    decisionService.updateOutcome(d1.id, "success");

    const d2 = await decisionService.logDecision({
      sessionId: "session-1", decisionType: "websearch", decision: "search 2", rationale: "test",
      metadata: { strategy: "research_first" },
    });
    decisionService.updateOutcome(d2.id, "failure");

    const d3 = await decisionService.logDecision({
      sessionId: "session-1", decisionType: "evolution", decision: "evo 1", rationale: "test",
      metadata: { strategy: "template_driven" },
    });
    decisionService.updateOutcome(d3.id, "success");

    const evaluator = new StrategyEvaluator();
    const result = await evaluator.getStrategyPerformance("session-1");

    expect(result).toHaveLength(2);

    const research = result.find((r) => r.strategy === "research_first");
    expect(research).toBeDefined();
    expect(research!.total).toBe(2);
    expect(research!.successes).toBe(1);
    expect(research!.failures).toBe(1);
    expect(research!.successRate).toBe(50);

    const template = result.find((r) => r.strategy === "template_driven");
    expect(template).toBeDefined();
    expect(template!.total).toBe(1);
    expect(template!.successes).toBe(1);
    expect(template!.successRate).toBe(100);
  });

  it("returns sorted by total descending", async () => {
    makeSession("session-2");
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");
    const { StrategyEvaluator } = await import("../../packages/engine/src/llm/strategy-evaluator.js");

    for (let i = 0; i < 5; i++) {
      const d = await decisionService.logDecision({
        sessionId: "session-2", decisionType: "websearch", decision: `s${i}`, rationale: "test",
        metadata: { strategy: "research_first" },
      });
      decisionService.updateOutcome(d.id, "success");
    }
    for (let i = 0; i < 3; i++) {
      const d = await decisionService.logDecision({
        sessionId: "session-2", decisionType: "evolution", decision: `e${i}`, rationale: "test",
        metadata: { strategy: "cautious" },
      });
      decisionService.updateOutcome(d.id, "success");
    }
    const d = await decisionService.logDecision({
      sessionId: "session-2", decisionType: "tool_use", decision: "t1", rationale: "test",
      metadata: { strategy: "exploratory" },
    });
    decisionService.updateOutcome(d.id, "failure");

    const evaluator = new StrategyEvaluator();
    const result = await evaluator.getStrategyPerformance("session-2");

    expect(result[0].strategy).toBe("research_first");
    expect(result[0].total).toBe(5);
    expect(result[1].strategy).toBe("cautious");
    expect(result[1].total).toBe(3);
    expect(result[2].strategy).toBe("exploratory");
    expect(result[2].total).toBe(1);
  });

  it("buildStrategyContext returns formatted string with stats", async () => {
    makeSession("session-3");
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");
    const { StrategyEvaluator } = await import("../../packages/engine/src/llm/strategy-evaluator.js");

    const d1 = await decisionService.logDecision({
      sessionId: "session-3", decisionType: "websearch", decision: "s1", rationale: "test",
      metadata: { strategy: "research_first" },
    });
    decisionService.updateOutcome(d1.id, "success");

    const evaluator = new StrategyEvaluator();
    const ctx = await evaluator.buildStrategyContext("session-3");

    expect(ctx).toContain("[Strategy Performance]");
    expect(ctx).toContain("research_first: 1/1 successful (100%)");
    expect(ctx).toContain("Overall: 1/1 (100%)");
  });

  it("only counts decisions with strategy in metadata", async () => {
    makeSession("session-4");
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");
    const { StrategyEvaluator } = await import("../../packages/engine/src/llm/strategy-evaluator.js");

    const d1 = await decisionService.logDecision({
      sessionId: "session-4", decisionType: "websearch", decision: "s1", rationale: "test",
      metadata: { strategy: "research_first" },
    });
    decisionService.updateOutcome(d1.id, "success");

    await decisionService.logDecision({
      sessionId: "session-4", decisionType: "websearch", decision: "s2", rationale: "test",
    });

    const evaluator = new StrategyEvaluator();
    const result = await evaluator.getStrategyPerformance("session-4");

    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(1);
  });

  it("reports convergence telemetry per strategy", async () => {
    makeSession("session-conv");
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");
    const { StrategyEvaluator } = await import("../../packages/engine/src/llm/strategy-evaluator.js");

    for (let i = 0; i < 30; i++) {
      const d = await decisionService.logDecision({
        sessionId: "session-conv", decisionType: "websearch", decision: `s${i}`, rationale: "test",
        metadata: { strategy: "research_first" },
      });
      decisionService.updateOutcome(d.id, i < 24 ? "success" : "failure");
    }
    for (let i = 0; i < 5; i++) {
      const d = await decisionService.logDecision({
        sessionId: "session-conv", decisionType: "evolution", decision: `e${i}`, rationale: "test",
        metadata: { strategy: "template_driven" },
      });
      decisionService.updateOutcome(d.id, "success");
    }

    const evaluator = new StrategyEvaluator();
    const conv = await evaluator.getStrategyConvergence("session-conv");

    expect(conv).toHaveLength(2);

    const r1 = conv.find((c) => c.strategy === "research_first");
    expect(r1).toBeDefined();
    expect(r1!.observations).toBe(30);
    expect(r1!.successRate).toBe(80);
    expect(r1!.confidence).toBe(1);
    expect(r1!.selectedCount).toBe(30);

    const r2 = conv.find((c) => c.strategy === "template_driven");
    expect(r2).toBeDefined();
    expect(r2!.observations).toBe(5);
    expect(r2!.successRate).toBe(100);
    expect(r2!.confidence).toBeLessThan(1);
    expect(r2!.selectedCount).toBe(5);
  });
});
