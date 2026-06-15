import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createSession } from "@arelyos/engine/persistence/session-store.js";
import { decisionService, setOutcomeUpdatedCallback } from "@arelyos/engine/llm/decision-service.js";
import { DecisionOutcomeLearner } from "@arelyos/engine/llm/decision-outcome-learner.js";
import { memoryService } from "@arelyos/engine/llm/memory-service.js";
import type { LLMAdapter } from "@arelyos/engine/llm/adapter.js";
import type { SessionMessage } from "@arelyos/engine/types.js";
import type { DecisionRecord } from "@arelyos/engine/llm/decision-types.js";

function mockLLM(response: string): LLMAdapter {
  return {
    async *complete(_messages: SessionMessage[], _signal?: AbortSignal) {
      yield { content: response };
    },
  };
}

let sessionId: string;

beforeEach(() => {
  initTestDb();
  const session = createSession({ query: "test", model: "test", toolMode: "native" });
  sessionId = session.id;
});

afterEach(() => {
  cleanupTestDb();
});

describe("DecisionOutcomeLearner", () => {
  it("learns from a successful decision", async () => {
    const record = await decisionService.logDecision({
      sessionId,
      decisionType: "tool_use",
      decision: "Used tool websearch to find documentation",
      rationale: "Agent needed to find API docs",
      confidence: 90,
      metadata: { toolName: "websearch", query: "API docs" },
    });

    decisionService.updateOutcome(record.id, "success", "Found relevant documentation");

    const learner = new DecisionOutcomeLearner(mockLLM(JSON.stringify([
      {
        type: "workflow_pattern",
        key: "websearch_effective_for_docs",
        value: "Web search is effective for finding API documentation",
        confidence: 85,
        tags: ["websearch", "documentation"],
      },
    ])));

    await learner.learnFromOutcome(record.id);

    const memories = await memoryService.searchMemories(sessionId, { limit: 10 });
    const learned = memories.filter((m) => m.tags.includes("auto-learned"));
    expect(learned.length).toBeGreaterThan(0);
    expect(learned[0].key).toBe("websearch_effective_for_docs");
  });

  it("learns from a failed decision", async () => {
    const record = await decisionService.logDecision({
      sessionId,
      decisionType: "evolution",
      decision: "Applied structural evolution pattern X",
      rationale: "Pattern X was expected to improve template Y",
      confidence: 70,
      metadata: { pattern: "X", template: "Y" },
    });

    decisionService.updateOutcome(record.id, "failure", "Template Y did not improve");

    const learner = new DecisionOutcomeLearner(mockLLM(JSON.stringify([
      {
        type: "project_fact",
        key: "pattern_x_ineffective",
        value: "Pattern X did not improve template Y — avoid for similar templates",
        confidence: 80,
        tags: ["evolution", "pattern-x"],
      },
    ])));

    await learner.learnFromOutcome(record.id);

    const memories = await memoryService.searchMemories(sessionId, { limit: 10 });
    const learned = memories.filter((m) => m.tags.includes("auto-learned"));
    expect(learned.length).toBeGreaterThan(0);
    expect(learned[0].type).toBe("project_fact");
  });

  it("skips learning for pending outcomes", async () => {
    const record = await decisionService.logDecision({
      sessionId,
      decisionType: "tool_use",
      decision: "test",
      rationale: "test",
    });

    const learner = new DecisionOutcomeLearner(mockLLM("[]"));
    await learner.learnFromOutcome(record.id);

    const memories = await memoryService.searchMemories(sessionId, { limit: 10 });
    expect(memories.filter((m) => m.tags.includes("auto-learned"))).toHaveLength(0);
  });

  it("handles unparseable LLM output gracefully", async () => {
    const record = await decisionService.logDecision({
      sessionId,
      decisionType: "tool_use",
      decision: "test",
      rationale: "test",
    });

    decisionService.updateOutcome(record.id, "success");

    const learner = new DecisionOutcomeLearner(mockLLM("not json at all"));
    await learner.learnFromOutcome(record.id);

    const memories = await memoryService.searchMemories(sessionId, { limit: 10 });
    expect(memories.filter((m) => m.tags.includes("auto-learned"))).toHaveLength(0);
  });

  it("setOutcomeUpdatedCallback fires on updateOutcome", async () => {
    let capturedId = "";
    setOutcomeUpdatedCallback((id) => { capturedId = id; });

    const record = await decisionService.logDecision({
      sessionId,
      decisionType: "tool_use",
      decision: "test",
      rationale: "test",
    });

    decisionService.updateOutcome(record.id, "success");

    expect(capturedId).toBe(record.id);
  });

  it("learnFromSessionOutcomes processes session decisions", async () => {
    const r1 = await decisionService.logDecision({
      sessionId,
      decisionType: "tool_use",
      decision: "Searched web for docs",
      rationale: "Needed documentation",
    });
    decisionService.updateOutcome(r1.id, "success");

    const r2 = await decisionService.logDecision({
      sessionId,
      decisionType: "tool_use",
      decision: "Fetched URL for data",
      rationale: "Needed specific page",
    });
    decisionService.updateOutcome(r2.id, "failure", "Page was not accessible");

    const learner = new DecisionOutcomeLearner(mockLLM(JSON.stringify([
      {
        type: "workflow_pattern",
        key: "test_learning",
        value: "Test learning from session outcomes",
        confidence: 75,
        tags: ["test"],
      },
    ])));

    await learner.learnFromSessionOutcomes(sessionId);

    const memories = await memoryService.searchMemories(sessionId, { limit: 10 });
    const learned = memories.filter((m) => m.tags.includes("auto-learned"));
    expect(learned.length).toBeGreaterThan(0);
  });
});
