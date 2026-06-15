import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { initTestDb, cleanupTestDb } from "../setup.js"
import { createSession } from "@arelyos/engine/persistence/session-store.js"
import { decisionService, setOutcomeUpdatedCallback } from "@arelyos/engine/llm/decision-service.js"
import { DecisionOutcomeLearner } from "@arelyos/engine/llm/decision-outcome-learner.js"
import { memoryService } from "@arelyos/engine/llm/memory-service.js"
import { memoryRetrievalService } from "@arelyos/engine/llm/memory-retrieval-service.js"
import type { LLMAdapter } from "@arelyos/engine/llm/adapter.js"
import type { SessionMessage } from "@arelyos/engine/types.js"

function mockLLM(response: string): LLMAdapter {
  return {
    async *complete(_messages: SessionMessage[], _signal?: AbortSignal) {
      yield { content: response }
    },
  }
}

let sessionId: string

beforeEach(() => {
  initTestDb()
  const session = createSession({ query: "test", model: "test", toolMode: "native" })
  sessionId = session.id
})

afterEach(() => {
  cleanupTestDb()
})

describe("Decision Outcome Lifecycle", () => {
  it("outcome update triggers callback and stores learned memory", async () => {
    let capturedId = ""
    setOutcomeUpdatedCallback((id) => { capturedId = id })

    const record = await decisionService.logDecision({
      sessionId,
      decisionType: "tool_use",
      decision: "Searched for TypeScript documentation",
      rationale: "User asked about TypeScript generics",
      confidence: 95,
      metadata: { toolName: "websearch" },
    })

    expect(record.outcome).toBe("pending")

    decisionService.updateOutcome(record.id, "success", "Found relevant TypeScript docs")

    const updated = decisionService.getDecision(record.id)
    expect(updated!.outcome).toBe("success")
    expect(updated!.outcomeDetail).toBe("Found relevant TypeScript docs")
    expect(capturedId).toBe(record.id)
  })

  it("learned memories from outcomes are retrievable via retrieval service", async () => {
    const record = await decisionService.logDecision({
      sessionId,
      decisionType: "architecture_decision",
      decision: "Adopted dependency injection pattern",
      rationale: "To improve testability and reduce coupling",
      confidence: 85,
      metadata: { pattern: "dependency-injection" },
    })

    decisionService.updateOutcome(record.id, "success")

    const learner = new DecisionOutcomeLearner(mockLLM(JSON.stringify([
      {
        type: "architecture_decision",
        key: "di_pattern_successful",
        value: "Dependency injection improved testability as expected",
        confidence: 80,
        tags: ["architecture", "di"],
      },
    ])))

    await learner.learnFromOutcome(record.id)

    // Verify the memory is retrievable
    const memories = await memoryService.searchMemories(sessionId, { limit: 10 })
    const learned = memories.filter((m) => m.tags.includes("auto-learned"))
    expect(learned.length).toBe(1)
    expect(learned[0].key).toBe("di_pattern_successful")

    // Verify via retrieval service
    const relevant = await memoryRetrievalService.getRelevant({
      sessionId,
      query: "dependency injection",
      limit: 5,
    })

    const diMem = relevant.find((m) => m.key === "di_pattern_successful")
    expect(diMem).toBeDefined()
    expect(diMem!.relevanceScore).toBeGreaterThan(0)
  })

  it("multiple outcomes with same type trigger correlation memory", async () => {
    // Log 3 successful websearch decisions
    for (let i = 0; i < 3; i++) {
      const r = await decisionService.logDecision({
        sessionId,
        decisionType: "websearch",
        decision: `Search query ${i}`,
        rationale: `Test rationale ${i}`,
      })
      decisionService.updateOutcome(r.id, "success")
    }

    const learner = new DecisionOutcomeLearner(mockLLM(JSON.stringify([
      {
        type: "workflow_pattern",
        key: "websearch_generic_success",
        value: "Web search consistently succeeds",
        confidence: 90,
        tags: ["websearch"],
      },
    ])))

    // Learning from one of them triggers correlation
    const all = decisionService.queryDecisions({ sessionId })
    await learner.learnFromOutcome(all[0].id)

    // Should create both the LLM learning AND the correlation memory
    const memories = await memoryService.searchMemories(sessionId, { limit: 10 })
    const learned = memories.filter((m) => m.tags.includes("auto-learned"))
    expect(learned.length).toBeGreaterThan(0)

    // Verify correlation pattern memory
    const correlationMem = memories.find((m) => m.key.includes("websearch_high_success_rate") || m.key.includes("high_success_rate"))
    expect(correlationMem).toBeDefined()
  })
})
