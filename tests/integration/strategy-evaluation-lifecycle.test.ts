import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createSession } from "@arelyos/engine/persistence/session-store.js";

function makeSession(id: string): void {
  createSession({ id, query: id, model: "test", toolMode: "native" });
}

describe("Strategy Evaluation Lifecycle", () => {
  beforeEach(() => {
    initTestDb();
  });

  afterEach(() => {
    cleanupTestDb();
    vi.restoreAllMocks();
  });

  it("evaluates strategy performance from decisions with strategy metadata", async () => {
    makeSession("session-lifecycle-1");
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");
    const { StrategyEvaluator } = await import("../../packages/engine/src/llm/strategy-evaluator.js");

    const evaluator = new StrategyEvaluator();

    for (let i = 0; i < 4; i++) {
      const d = await decisionService.logDecision({
        sessionId: "session-lifecycle-1",
        decisionType: "websearch",
        decision: `search ${i}`,
        rationale: "test",
        metadata: { strategy: "research_first" },
      });
      decisionService.updateOutcome(d.id, i < 3 ? "success" : "failure");
    }

    for (let i = 0; i < 2; i++) {
      const d = await decisionService.logDecision({
        sessionId: "session-lifecycle-1",
        decisionType: "evolution",
        decision: `evo ${i}`,
        rationale: "test",
        metadata: { strategy: "template_driven" },
      });
      decisionService.updateOutcome(d.id, "success");
    }

    const stats = await evaluator.getStrategyPerformance("session-lifecycle-1");

    expect(stats).toHaveLength(2);

    const research = stats.find((s) => s.strategy === "research_first");
    expect(research).toBeDefined();
    expect(research!.total).toBe(4);
    expect(research!.successes).toBe(3);
    expect(research!.successRate).toBe(75);

    const template = stats.find((s) => s.strategy === "template_driven");
    expect(template).toBeDefined();
    expect(template!.total).toBe(2);
    expect(template!.successRate).toBe(100);
  });

  it("strategy context is included in buildMetaContextString after evaluation", async () => {
    makeSession("session-lifecycle-2");
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");
    const { MetaReasoner } = await import("../../packages/engine/src/llm/meta-reasoner.js");

    for (let i = 0; i < 3; i++) {
      const d = await decisionService.logDecision({
        sessionId: "session-lifecycle-2",
        decisionType: "websearch",
        decision: `search ${i}`,
        rationale: "test",
        metadata: { strategy: "cautious" },
      });
      decisionService.updateOutcome(d.id, "success");
    }

    const reasoner = new MetaReasoner();
    const ctx = await reasoner.buildMetaContextString("session-lifecycle-2");

    expect(ctx).toContain("[Decision History]");
    expect(ctx).not.toContain("[Strategy Performance History]");
  });

  it("storeStrategySummary stores strategy performance in memory", async () => {
    makeSession("session-lifecycle-3");
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");
    const { memoryService } = await import("../../packages/engine/src/llm/memory-service.js");
    const { StrategyEvaluator } = await import("../../packages/engine/src/llm/strategy-evaluator.js");

    for (let i = 0; i < 2; i++) {
      const d = await decisionService.logDecision({
        sessionId: "session-lifecycle-3",
        decisionType: "websearch",
        decision: `search ${i}`,
        rationale: "test",
        metadata: { strategy: "confident" },
      });
      decisionService.updateOutcome(d.id, "success");
    }

    const evaluator = new StrategyEvaluator();
    await evaluator.storeStrategySummary("session-lifecycle-3");

    const memories = await memoryService.searchMemories("session-lifecycle-3", { limit: 50 });
    const stratMem = memories.find((m) => m.tags.includes("strategy-performance"));

    expect(stratMem).toBeDefined();
    expect(stratMem!.value).toContain("confident: 2/2 (100%)");
    expect(stratMem!.tags).toContain("auto-learned");
    expect(stratMem!.tags).toContain("strategy-performance");
  });

  it("evaluator only considers current session decisions", async () => {
    makeSession("session-a");
    makeSession("session-b");
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");
    const { StrategyEvaluator } = await import("../../packages/engine/src/llm/strategy-evaluator.js");

    const evaluator = new StrategyEvaluator();

    const d1 = await decisionService.logDecision({
      sessionId: "session-a",
      decisionType: "websearch",
      decision: "a1",
      rationale: "test",
      metadata: { strategy: "exploratory" },
    });
    decisionService.updateOutcome(d1.id, "success");

    const d2 = await decisionService.logDecision({
      sessionId: "session-b",
      decisionType: "websearch",
      decision: "b1",
      rationale: "test",
      metadata: { strategy: "confident" },
    });
    decisionService.updateOutcome(d2.id, "failure");

    const statsA = await evaluator.getStrategyPerformance("session-a");
    expect(statsA).toHaveLength(1);
    expect(statsA[0].strategy).toBe("exploratory");

    const statsB = await evaluator.getStrategyPerformance("session-b");
    expect(statsB).toHaveLength(1);
    expect(statsB[0].strategy).toBe("confident");
  });

  it("decisions without strategy metadata are excluded", async () => {
    makeSession("session-nometa");
    const { decisionService } = await import("../../packages/engine/src/llm/decision-service.js");
    const { StrategyEvaluator } = await import("../../packages/engine/src/llm/strategy-evaluator.js");

    const evaluator = new StrategyEvaluator();

    const d1 = await decisionService.logDecision({
      sessionId: "session-nometa",
      decisionType: "websearch",
      decision: "s1",
      rationale: "test",
      metadata: { strategy: "cautious" },
    });
    decisionService.updateOutcome(d1.id, "success");

    await decisionService.logDecision({
      sessionId: "session-nometa",
      decisionType: "websearch",
      decision: "s2",
      rationale: "test",
    });

    const stats = await evaluator.getStrategyPerformance("session-nometa");
    expect(stats).toHaveLength(1);
    expect(stats[0].total).toBe(1);
  });
});
