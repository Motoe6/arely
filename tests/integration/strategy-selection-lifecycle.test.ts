import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createSession } from "@arelyos/engine/persistence/session-store.js";

describe("Strategy Selection Lifecycle", () => {
  beforeEach(() => {
    initTestDb();
  });

  afterEach(() => {
    cleanupTestDb();
    vi.restoreAllMocks();
  });

  it("selects argmax strategy from observed performance data", async () => {
    const session1 = createSession({ query: "test1", model: "test", toolMode: "native" });
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");
    const { StrategySelector } = await import("../../packages/engine/src/llm/strategy-selector.js");

    const selector = new StrategySelector();

    // Phase 1: Build strategy performance — research_first 100%, template_driven 50%
    for (let i = 0; i < 3; i++) {
      const r = await decisionService.logDecision({
        sessionId: session1.id, decisionType: "websearch", decision: `s${i}`, rationale: "test",
        metadata: { strategy: "research_first" },
      });
      decisionService.updateOutcome(r.id, "success");
    }

    for (let i = 0; i < 2; i++) {
      const r = await decisionService.logDecision({
        sessionId: session1.id, decisionType: "evolution", decision: `e${i}`, rationale: "test",
        metadata: { strategy: "template_driven" },
      });
      decisionService.updateOutcome(r.id, i < 1 ? "success" : "failure");
    }

    const p1 = await selector.recommend(session1.id);
    // research_first: 100% (3/3) > template_driven: 50% (1/2)
    expect(p1.strategy).toBe("research_first");
    expect(p1.label).toContain("100%");
  });

  it("strategy adapts when performance data changes", async () => {
    const session = createSession({ query: "adapt-test", model: "test", toolMode: "native" });
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");
    const { StrategySelector } = await import("../../packages/engine/src/llm/strategy-selector.js");

    const selector = new StrategySelector();

    // Phase 1: template_driven 80% (4/5), research_first 50% (1/2)
    for (let i = 0; i < 5; i++) {
      const r = await decisionService.logDecision({
        sessionId: session.id, decisionType: "evolution", decision: `e${i}`, rationale: "test",
        metadata: { strategy: "template_driven" },
      });
      decisionService.updateOutcome(r.id, i < 4 ? "success" : "failure");
    }
    for (let i = 0; i < 2; i++) {
      const r = await decisionService.logDecision({
        sessionId: session.id, decisionType: "websearch", decision: `s${i}`, rationale: "test",
        metadata: { strategy: "research_first" },
      });
      decisionService.updateOutcome(r.id, i < 1 ? "success" : "failure");
    }

    const p1 = await selector.recommend(session.id);
    expect(p1.strategy).toBe("template_driven");

    // Phase 2: Add more data — research_first climbs to 80% (4/5), template_driven drops
    for (let i = 2; i < 5; i++) {
      const r = await decisionService.logDecision({
        sessionId: session.id, decisionType: "websearch", decision: `s${i}`, rationale: "test",
        metadata: { strategy: "research_first" },
      });
      decisionService.updateOutcome(r.id, "success");
    }
    for (let i = 5; i < 8; i++) {
      const r = await decisionService.logDecision({
        sessionId: session.id, decisionType: "evolution", decision: `e${i}`, rationale: "test",
        metadata: { strategy: "template_driven" },
      });
      decisionService.updateOutcome(r.id, "failure");
    }

    const p2 = await selector.recommend(session.id);
    // research_first: 4/5 (80%) > template_driven: 4/8 (50%)
    expect(p2.strategy).toBe("research_first");
  });

  it("falls back to overall rate when no strategy performance data exists", async () => {
    const session = createSession({ query: "no-strategy-perf", model: "test", toolMode: "native" });
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");
    const { StrategySelector } = await import("../../packages/engine/src/llm/strategy-selector.js");

    const selector = new StrategySelector();

    // Decisions without strategy metadata — no strategy perf data
    for (let i = 0; i < 3; i++) {
      const r = await decisionService.logDecision({
        sessionId: session.id, decisionType: "websearch", decision: `s${i}`, rationale: "test",
      });
      decisionService.updateOutcome(r.id, "success");
    }
    const r = await decisionService.logDecision({
      sessionId: session.id, decisionType: "tool_use", decision: "t1", rationale: "test",
    });
    decisionService.updateOutcome(r.id, "failure");

    const rec = await selector.recommend(session.id);
    // overallRate: 3/4 = 75%, all strategies get 75%
    // first candidate wins (research_first), weakNote: none (tool_use only 1 obs)
    expect(rec.instruction).toContain("75%");
    expect(rec.label).toContain("75%");
  });

  it("includes weak area warnings in instruction", async () => {
    const session = createSession({ query: "weak-test", model: "test", toolMode: "native" });
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");
    const { StrategySelector } = await import("../../packages/engine/src/llm/strategy-selector.js");

    const selector = new StrategySelector();

    // tool_use: 0/3 (0%) with ≥2 obs → weak
    for (let i = 0; i < 3; i++) {
      const r = await decisionService.logDecision({
        sessionId: session.id, decisionType: "tool_use", decision: `t${i}`, rationale: "test",
        metadata: { strategy: "exploratory" },
      });
      decisionService.updateOutcome(r.id, "failure");
    }

    const rec = await selector.recommend(session.id);
    // overallRate: 0/3 = 0% → all strategies 0% → research_first wins
    // weakNote should flag tool_use
    expect(rec.instruction).toContain("Areas needing caution");
    expect(rec.instruction).toContain("tool_use");
    expect(rec.instruction).toContain("0%");
  });
});
