import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createSession } from "@arelyos/engine/persistence/session-store.js";
import { MetaReasoner } from "@arelyos/engine/llm/meta-reasoner.js";
import { decisionService } from "@arelyos/engine/llm/decision-service.js";
import { memoryService } from "@arelyos/engine/llm/memory-service.js";

let sessionId: string;

beforeEach(() => {
  initTestDb();
  const session = createSession({ query: "test", model: "test", toolMode: "native" });
  sessionId = session.id;
});

afterEach(() => {
  cleanupTestDb();
});

describe("MetaReasoner", () => {
  it("buildDecisionStats returns empty for session with no decisions", async () => {
    const reasoner = new MetaReasoner();
    const stats = await reasoner.buildDecisionStats(sessionId);
    expect(stats).toEqual([]);
  });

  it("buildDecisionStats groups by decision type", async () => {
    await decisionService.logDecision({
      sessionId, decisionType: "websearch", decision: "search 1", rationale: "test",
    });
    await decisionService.logDecision({
      sessionId, decisionType: "websearch", decision: "search 2", rationale: "test",
    });
    await decisionService.logDecision({
      sessionId, decisionType: "evolution", decision: "evolve", rationale: "test",
    });

    const reasoner = new MetaReasoner();
    const stats = await reasoner.buildDecisionStats(sessionId);

    expect(stats).toHaveLength(2);
    const ws = stats.find((s) => s.type === "websearch");
    const ev = stats.find((s) => s.type === "evolution");
    expect(ws?.total).toBe(2);
    expect(ev?.total).toBe(1);
  });

  it("buildDecisionStats calculates success rates", async () => {
    for (let i = 0; i < 4; i++) {
      const r = await decisionService.logDecision({
        sessionId, decisionType: "tool_use", decision: `d${i}`, rationale: "test",
      });
      if (i < 3) decisionService.updateOutcome(r.id, "success");
      else decisionService.updateOutcome(r.id, "failure");
    }

    const reasoner = new MetaReasoner();
    const stats = await reasoner.buildDecisionStats(sessionId);

    expect(stats).toHaveLength(1);
    expect(stats[0].successes).toBe(3);
    expect(stats[0].failures).toBe(1);
    expect(stats[0].successRate).toBe(75);
  });

  it("buildMetaContextString includes decision stats and learned patterns", async () => {
    const r = await decisionService.logDecision({
      sessionId, decisionType: "websearch", decision: "search", rationale: "test",
    });
    decisionService.updateOutcome(r.id, "success");

    await memoryService.setMemory(sessionId, "workflow_pattern", "ws_works", "Web search works well", 90, "derived", ["auto-learned"]);

    const reasoner = new MetaReasoner();
    const ctx = await reasoner.buildMetaContextString(sessionId);

    expect(ctx).toContain("Decision History");
    expect(ctx).toContain("websearch");
    expect(ctx).toContain("1/1");
    expect(ctx).toContain("100%");
    expect(ctx).toContain("Learned Patterns");
    expect(ctx).toContain("ws_works");
  });

  it("buildMetaContextString highlights areas needing attention", async () => {
    const r = await decisionService.logDecision({
      sessionId, decisionType: "evolution", decision: "bad evolution", rationale: "test",
    });
    decisionService.updateOutcome(r.id, "failure");

    await memoryService.setMemory(sessionId, "project_fact", "evo_needs_review", "Evolution decisions need review", 80, "derived", ["needs-attention"]);

    const reasoner = new MetaReasoner();
    const ctx = await reasoner.buildMetaContextString(sessionId);

    expect(ctx).toContain("Areas Needing Attention");
    expect(ctx).toContain("evo_needs_review");
  });

  it("reflectOnSession stores a reflection memory", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await decisionService.logDecision({
        sessionId, decisionType: "tool_use", decision: `d${i}`, rationale: "test",
      });
      decisionService.updateOutcome(r.id, i < 2 ? "success" : "failure");
    }

    const reasoner = new MetaReasoner();
    await reasoner.reflectOnSession(sessionId);

    const memories = await memoryService.searchMemories(sessionId, { limit: 10 });
    const reflection = memories.find((m) => m.tags.includes("meta-reflection"));
    expect(reflection).toBeDefined();
    expect(reflection!.value).toContain("2/3");
    expect(reflection!.value).toContain("%");
  });

  it("reflectOnSession handles session with no decisions", async () => {
    const reasoner = new MetaReasoner();
    await reasoner.reflectOnSession(sessionId);

    const memories = await memoryService.searchMemories(sessionId, { limit: 10 });
    expect(memories.length).toBe(0);
  });

  it("buildMetaContextString returns empty string for empty session", async () => {
    const reasoner = new MetaReasoner();
    const ctx = await reasoner.buildMetaContextString(sessionId);
    expect(ctx).toBe("");
  });
});
