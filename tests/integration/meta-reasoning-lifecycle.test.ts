import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { initTestDb, cleanupTestDb } from "../setup.js"
import { createSession } from "@arely/engine/persistence/session-store.js"
import { decisionService } from "@arely/engine/llm/decision-service.js"
import { memoryService } from "@arely/engine/llm/memory-service.js"
import { MetaReasoner } from "@arely/engine/llm/meta-reasoner.js"
import { memoryRetrievalService } from "@arely/engine/llm/memory-retrieval-service.js"

let sessionId: string

beforeEach(() => {
  initTestDb()
  const session = createSession({ query: "test", model: "test", toolMode: "native" })
  sessionId = session.id
})

afterEach(() => {
  cleanupTestDb()
})

describe("Meta Reasoning Lifecycle", () => {
  it("decision stats + learned patterns + reflection produce complete meta-context", async () => {
    // Seed: 3 websearch decisions (2 success, 1 failure)
    for (let i = 0; i < 3; i++) {
      const r = await decisionService.logDecision({
        sessionId,
        decisionType: "websearch",
        decision: `Search query ${i}`,
        rationale: `Test rationale ${i}`,
      })
      decisionService.updateOutcome(r.id, i < 2 ? "success" : "failure")
    }

    // Seed: 2 evolution decisions (all success)
    for (let i = 0; i < 2; i++) {
      const r = await decisionService.logDecision({
        sessionId,
        decisionType: "evolution",
        decision: `Evolution ${i}`,
        rationale: `Evo test ${i}`,
      })
      decisionService.updateOutcome(r.id, "success")
    }

    // Seed: learned pattern memory
    await memoryService.setMemory(
      sessionId,
      "workflow_pattern",
      "websearch_reliable",
      "Web search is reliable for factual queries",
      95,
      "derived",
      ["auto-learned"],
    )

    const reasoner = new MetaReasoner()

    // Build meta-context
    const ctx = await reasoner.buildMetaContextString(sessionId)

    expect(ctx).toContain("Decision History")
    expect(ctx).toContain("websearch")
    expect(ctx).toContain("evolution")
    expect(ctx).toContain("2/3")
    expect(ctx).toContain("2/2")
    expect(ctx).toContain("Learned Patterns")
    expect(ctx).toContain("websearch_reliable")

    // Reflect
    await reasoner.reflectOnSession(sessionId)

    const memories = await memoryService.searchMemories(sessionId, { limit: 10 })
    const reflection = memories.find((m) => m.tags.includes("meta-reflection"))
    expect(reflection).toBeDefined()
    expect(reflection!.value).toContain("4/5")
  })

  it("meta-reflection memories are retrievable via retrieval service", async () => {
    const r = await decisionService.logDecision({
      sessionId,
      decisionType: "tool_use",
      decision: "Test decision",
      rationale: "Test",
    })
    decisionService.updateOutcome(r.id, "success")

    const reasoner = new MetaReasoner()
    await reasoner.reflectOnSession(sessionId)

    const relevant = await memoryRetrievalService.getRelevant({
      sessionId,
      query: "session reflection performance",
      limit: 5,
    })

    const reflection = relevant.find((m) => m.tags.includes("meta-reflection"))
    expect(reflection).toBeDefined()
    expect(reflection!.relevanceScore).toBeGreaterThan(0)
  })

  it("meta-context and memory context compose correctly", async () => {
    const r = await decisionService.logDecision({
      sessionId,
      decisionType: "websearch",
      decision: "test search",
      rationale: "test",
    })
    decisionService.updateOutcome(r.id, "success")

    await memoryService.setMemory(
      sessionId,
      "user_preference",
      "likes_typescript",
      "User prefers TypeScript",
      90,
      "inferred",
      ["language"],
    )

    const reasoner = new MetaReasoner()
    const metaCtx = await reasoner.buildMetaContextString(sessionId)

    // Meta-context has decision stats
    expect(metaCtx).toContain("websearch")
    expect(metaCtx).toContain("1/1")

    // Memory context (via injectMemoryIntoContext) would have the user preference
    // They compose as separate system messages in the LLM context
    // This test verifies both sources produce valid, non-overlapping content
    expect(metaCtx).not.toContain("likes_typescript")
  })
})
