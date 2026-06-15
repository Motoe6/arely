import { describe, it, expect, beforeEach, vi } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createSession } from "../../packages/engine/src/persistence/session-store.js";

vi.mock("../../packages/engine/src/config/index.js", () => ({
  getConfig: vi.fn(() => ({})),
}));

function makeSession(id: string): { id: string } {
  return createSession({ id, query: id, model: "test", toolMode: "native" });
}

describe("StrategySelector", () => {
  let sessionId: string;

  beforeEach(() => {
    initTestDb();
    sessionId = makeSession("selector-test").id;
  });

  afterEach(() => {
    cleanupTestDb();
    vi.restoreAllMocks();
  });

  it("returns exploratory when no decisions exist", async () => {
    const { StrategySelector } = await import("../../packages/engine/src/llm/strategy-selector.js");
    const selector = new StrategySelector();
    const rec = await selector.recommend("empty-session");
    expect(rec.strategy).toBe("exploratory");
    expect(rec.label).toBe("No prior data");
  });

  it("picks argmax from strategy performance when data is available", async () => {
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");

    // research_first: 3/4 success (75%)
    for (let i = 0; i < 4; i++) {
      const r = await decisionService.logDecision({
        sessionId, decisionType: "websearch", decision: `s${i}`, rationale: "test",
        metadata: { strategy: "research_first" },
      });
      decisionService.updateOutcome(r.id, i < 3 ? "success" : "failure");
    }

    // template_driven: 1/2 success (50%)
    for (let i = 0; i < 2; i++) {
      const r = await decisionService.logDecision({
        sessionId, decisionType: "evolution", decision: `e${i}`, rationale: "test",
        metadata: { strategy: "template_driven" },
      });
      decisionService.updateOutcome(r.id, i < 1 ? "success" : "failure");
    }

    const { StrategySelector } = await import("../../packages/engine/src/llm/strategy-selector.js");
    const selector = new StrategySelector();
    const rec = await selector.recommend(sessionId);

    // research_first: 75% > template_driven: 50% → argmax picks research_first
    expect(rec.strategy).toBe("research_first");
    expect(rec.label).toContain("75%");
    expect(rec.instruction).toContain("75%");
  });

  it("uses expected value not priority when strategy perf inverts ranking", async () => {
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");

    // template_driven: 4/4 (100%)
    for (let i = 0; i < 4; i++) {
      const r = await decisionService.logDecision({
        sessionId, decisionType: "evolution", decision: `e${i}`, rationale: "test",
        metadata: { strategy: "template_driven" },
      });
      decisionService.updateOutcome(r.id, "success");
    }

    // research_first: 1/4 (25%)
    for (let i = 0; i < 4; i++) {
      const r = await decisionService.logDecision({
        sessionId, decisionType: "websearch", decision: `s${i}`, rationale: "test",
        metadata: { strategy: "research_first" },
      });
      decisionService.updateOutcome(r.id, i < 1 ? "success" : "failure");
    }

    const { StrategySelector } = await import("../../packages/engine/src/llm/strategy-selector.js");
    const selector = new StrategySelector();
    const rec = await selector.recommend(sessionId);

    // template_driven: 100% > research_first: 25% → template_driven selected
    expect(rec.strategy).toBe("template_driven");
    expect(rec.label).toContain("100%");
  });

  it("picks highest expected rate when all strategies have data", async () => {
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");

    const perf: Array<[string, number, number]> = [
      ["exploratory", 2, 1],    // 50%
      ["cautious", 3, 2],       // 67%
      ["confident", 2, 2],      // 100%
    ];

    for (const [strategy, total, successes] of perf) {
      for (let i = 0; i < total; i++) {
        const r = await decisionService.logDecision({
          sessionId, decisionType: "websearch", decision: `${strategy}-${i}`, rationale: "test",
          metadata: { strategy },
        });
        decisionService.updateOutcome(r.id, i < successes ? "success" : "failure");
      }
    }

    const { StrategySelector } = await import("../../packages/engine/src/llm/strategy-selector.js");
    const selector = new StrategySelector();
    const rec = await selector.recommend(sessionId);

    // confident: 100% > cautious: 67% > exploratory: 50%
    expect(rec.strategy).toBe("confident");
    expect(rec.label).toContain("100%");
  });

  it("falls back to overall rate when strategy has insufficient data", async () => {
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");

    // Only 1 observation per strategy — insufficient for perf data (< 2)
    const r1 = await decisionService.logDecision({
      sessionId, decisionType: "websearch", decision: "s1", rationale: "test",
      metadata: { strategy: "research_first" },
    });
    decisionService.updateOutcome(r1.id, "success");

    const r2 = await decisionService.logDecision({
      sessionId, decisionType: "websearch", decision: "s2", rationale: "test",
      metadata: { strategy: "template_driven" },
    });
    decisionService.updateOutcome(r2.id, "failure");

    // Total: 1/2 = 50% overall — all strategies fall back to 50%
    const { StrategySelector } = await import("../../packages/engine/src/llm/strategy-selector.js");
    const selector = new StrategySelector();
    const rec = await selector.recommend(sessionId);

    // All have 50% expected → first candidate wins (research_first)
    expect(rec.strategy).toBe("research_first");
    expect(rec.instruction).toContain("50%");
  });

  it("adds weak area note to instruction when decision types have low success", async () => {
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");

    // tool_use: 0/2 (0%) — weak
    for (let i = 0; i < 2; i++) {
      const r = await decisionService.logDecision({
        sessionId, decisionType: "tool_use", decision: `t${i}`, rationale: "test",
        metadata: { strategy: "exploratory" },
      });
      decisionService.updateOutcome(r.id, "failure");
    }
    // websearch: 3/3 (100%) — strong
    for (let i = 0; i < 3; i++) {
      const r = await decisionService.logDecision({
        sessionId, decisionType: "websearch", decision: `s${i}`, rationale: "test",
        metadata: { strategy: "exploratory" },
      });
      decisionService.updateOutcome(r.id, "success");
    }

    const { StrategySelector } = await import("../../packages/engine/src/llm/strategy-selector.js");
    const selector = new StrategySelector();
    const rec = await selector.recommend(sessionId);

    // exploratory: 2/5 (40%) with 5 obs → all strategies get 60% (overall 3/5)
    // actually total = 5, successes = 3, overallRate = 60%
    // all strategies get 60% → research_first wins (first in array)
    expect(rec.instruction).toContain("Areas needing caution");
    expect(rec.instruction).toContain("tool_use");
  });

  it("includes expected success rate in label and instruction", async () => {
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");

    const r = await decisionService.logDecision({
      sessionId, decisionType: "websearch", decision: "s1", rationale: "test",
      metadata: { strategy: "research_first" },
    });
    decisionService.updateOutcome(r.id, "success");

    const { StrategySelector } = await import("../../packages/engine/src/llm/strategy-selector.js");
    const selector = new StrategySelector();
    const rec = await selector.recommend(sessionId);

    expect(rec.label).toContain("%");
    expect(rec.instruction).toContain("Expected success rate");
  });
});
