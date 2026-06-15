import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { initTestDb, cleanupTestDb } from "../setup.js"
import { createSession } from "@arely/engine/persistence/session-store.js"
import {
  initEpoch,
  addEpochMessageToSession,
  setEpochSummarizer,
  setEpochThreshold,
} from "@arely/engine/llm/context-epoch-service.js"
import { getEpochsBySession } from "@arely/engine/persistence/context-epoch-store.js"
import { memoryService } from "@arely/engine/llm/memory-service.js"
import { memoryRetrievalService } from "@arely/engine/llm/memory-retrieval-service.js"
import { decisionService } from "@arely/engine/llm/decision-service.js"
import { extractMemories } from "@arely/engine/llm/auto-memory-extractor.js"
import type { LLMAdapter } from "@arely/engine/llm/adapter.js"
import type { SessionMessage } from "@arely/engine/types.js"

let sessionId: string

function mockLLM(responses: string[]): LLMAdapter {
  let callIndex = 0
  return {
    async *complete(_messages: SessionMessage[], _signal?: AbortSignal) {
      const resp = responses[callIndex] ?? responses[responses.length - 1] ?? ""
      callIndex++
      yield { content: resp }
    },
  }
}

beforeEach(() => {
  initTestDb()
  const session = createSession({ query: "test", model: "test", toolMode: "native" })
  sessionId = session.id
})

afterEach(() => {
  cleanupTestDb()
})

describe("Auto-Memory Lifecycle", () => {
  it("extracts memories and stores them via memory service", async () => {
    const llm = mockLLM([JSON.stringify([
      { type: "user_preference", key: "likes_vitest", value: "User prefers Vitest over Jest", confidence: 90, tags: ["testing"] },
    ])])

    const memories = await extractMemories(
      [{ role: "user", content: "I prefer Vitest over Jest for testing" }],
      { llm },
    )

    expect(memories).toHaveLength(1)
    expect(memories[0].type).toBe("user_preference")

    // Store the extracted memory
    for (const mem of memories) {
      await memoryService.setMemory(sessionId, mem.type, mem.key, mem.value, mem.confidence, mem.source, mem.tags)
    }

    // Verify it's retrievable
    const retrieved = await memoryService.searchMemories(sessionId, { limit: 10 })
    expect(retrieved).toHaveLength(1)
    expect(retrieved[0].key).toBe("likes_vitest")
    expect(retrieved[0].value).toBe("User prefers Vitest over Jest")
  })

  it("LLM epoch summarizer updates baseline on rotation", async () => {
    const llm = mockLLM(["LLM summary: conversation about testing frameworks"])

    // Use the async epoch summarizer with the mock LLM
    let capturedMessages: Array<{role: string; content: string}> = []
    setEpochSummarizer(async (_epochId, messages) => {
      capturedMessages = messages
      const result = await extractMemories(
        messages.map((m) => ({ role: m.role, content: m.content })),
        { llm },
      )
      // Store any extracted memories
      for (const mem of result) {
        await memoryService.setMemory(sessionId, mem.type, mem.key, mem.value, mem.confidence, mem.source, mem.tags)
      }
      return "LLM summary: conversation about testing frameworks"
    })

    setEpochThreshold(2)
    initEpoch(sessionId)
    addEpochMessageToSession(sessionId, "user", "I like Vitest")
    addEpochMessageToSession(sessionId, "user", "It works well")

    await new Promise((r) => setTimeout(r, 100))

    const epochs = getEpochsBySession(sessionId)
    expect(epochs.length).toBe(2)
    expect(epochs[0].baselineContext).toContain("LLM summary")
    expect(capturedMessages).toHaveLength(2)
  })

  it("decision logging works with onDecision-style payload", async () => {
    const record = await decisionService.logDecision({
      sessionId,
      decisionType: "tool_use",
      decision: "Used tool websearch",
      rationale: "Agent needed to find current information",
      confidence: 95,
      metadata: { toolName: "websearch", query: "latest news" },
    })

    expect(record.sessionId).toBe(sessionId)
    expect(record.decisionType).toBe("tool_use")
    expect(record.decision).toBe("Used tool websearch")
    expect(record.confidence).toBe(95)

    // Verify retrieval
    const results = decisionService.queryDecisions({ sessionId })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(record.id)
  })

  it("extracted memories are retrievable via memory retrieval service", async () => {
    const llm = mockLLM([JSON.stringify([
      { type: "user_preference", key: "likes_typescript", value: "User prefers TypeScript", confidence: 85, tags: ["language"] },
    ])])

    // Extract and store
    const memories = await extractMemories(
      [{ role: "user", content: "I really like TypeScript for type safety" }],
      { llm },
    )

    for (const mem of memories) {
      await memoryService.setMemory(sessionId, mem.type, mem.key, mem.value, mem.confidence, mem.source, mem.tags)
    }

    // Verify via retrieval service using relevance scoring
    const relevant = await memoryRetrievalService.getRelevant({
      sessionId,
      query: "TypeScript",
      limit: 5,
    })

    expect(relevant.length).toBeGreaterThan(0)
    const tsMem = relevant.find((m) => m.key === "likes_typescript")
    expect(tsMem).toBeDefined()
    expect(tsMem!.relevanceScore).toBeGreaterThan(0)
  })
})
