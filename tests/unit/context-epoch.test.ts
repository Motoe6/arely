import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { initTestDb, cleanupTestDb } from "../setup.js"
import { createSession } from "@arelyos/engine/persistence/session-store.js"
import {
  createEpoch,
  getEpoch,
  getEpochsBySession,
  getCurrentEpoch,
  updateEpoch,
  addEpochMessage,
  getEpochMessages,
  getRecentMessages,
  getEpochMessageCount as getMessageCount,
} from "@arelyos/engine/persistence/context-epoch-store.js"
import {
  initEpoch,
  addEpochMessageToSession,
  maybeRotateEpoch,
  summarizeEpoch,
  buildContext,
  getContextStats,
  setEpochThreshold,
  setEpochSummarizer,
  type EpochSummarizer,
} from "@arelyos/engine/llm/context-epoch-service.js"

let sessionId: string

beforeEach(() => {
  initTestDb()
  const session = createSession({ query: "test", model: "test", toolMode: "native" })
  sessionId = session.id
})

afterEach(() => {
  cleanupTestDb()
})

describe("ContextEpochStore", () => {
  it("creates and retrieves an epoch", () => {
    const epoch = createEpoch({ sessionId, epochNumber: 1 })
    expect(epoch.sessionId).toBe(sessionId)
    expect(epoch.epochNumber).toBe(1)
    expect(epoch.messageCount).toBe(0)

    const fetched = getEpoch(epoch.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(epoch.id)
  })

  it("returns null for missing epoch", () => {
    expect(getEpoch("nonexistent")).toBeNull()
  })

  it("lists epochs by session ordered by number", () => {
    createEpoch({ sessionId, epochNumber: 1 })
    createEpoch({ sessionId, epochNumber: 2 })
    const list = getEpochsBySession(sessionId)
    expect(list).toHaveLength(2)
    expect(list[0].epochNumber).toBe(1)
    expect(list[1].epochNumber).toBe(2)
  })

  it("gets current (latest) epoch", () => {
    createEpoch({ sessionId, epochNumber: 1 })
    createEpoch({ sessionId, epochNumber: 2 })
    const current = getCurrentEpoch(sessionId)
    expect(current).not.toBeNull()
    expect(current!.epochNumber).toBe(2)
  })

  it("updates epoch baseline context", () => {
    const epoch = createEpoch({ sessionId, epochNumber: 1 })
    const updated = updateEpoch(epoch.id, { baselineContext: "summary" })
    expect(updated!.baselineContext).toBe("summary")
  })

  it("adds epoch message and increments count", () => {
    const epoch = createEpoch({ sessionId, epochNumber: 1 })
    addEpochMessage({ sessionId, epochId: epoch.id, role: "user", content: "hello", sequence: 1 })
    const refreshed = getEpoch(epoch.id)
    expect(refreshed!.messageCount).toBe(1)
  })

  it("retrieves messages in sequence order", () => {
    const epoch = createEpoch({ sessionId, epochNumber: 1 })
    addEpochMessage({ sessionId, epochId: epoch.id, role: "user", content: "first", sequence: 1 })
    addEpochMessage({ sessionId, epochId: epoch.id, role: "assistant", content: "second", sequence: 2 })
    const msgs = getEpochMessages(epoch.id)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].content).toBe("first")
    expect(msgs[1].content).toBe("second")
  })

  it("gets recent messages with limit", () => {
    const e1 = createEpoch({ sessionId, epochNumber: 1 })
    const e2 = createEpoch({ sessionId, epochNumber: 2 })
    addEpochMessage({ sessionId, epochId: e1.id, role: "user", content: "m1", sequence: 1 })
    addEpochMessage({ sessionId, epochId: e2.id, role: "user", content: "m2", sequence: 2 })
    const recent = getRecentMessages(sessionId, 1)
    expect(recent).toHaveLength(1)
    expect(recent[0].content).toBe("m2")
  })

  it("counts messages for session", () => {
    const e1 = createEpoch({ sessionId, epochNumber: 1 })
    const e2 = createEpoch({ sessionId, epochNumber: 2 })
    addEpochMessage({ sessionId, epochId: e1.id, role: "user", content: "a", sequence: 1 })
    addEpochMessage({ sessionId, epochId: e2.id, role: "assistant", content: "b", sequence: 2 })
    expect(getMessageCount(sessionId)).toBe(2)
  })
})

describe("ContextEpochService", () => {
  it("initEpoch creates first epoch", () => {
    const epoch = initEpoch(sessionId)
    expect(epoch.epochNumber).toBe(1)
    expect(epoch.sessionId).toBe(sessionId)
  })

  it("initEpoch returns existing epoch if already initialized", () => {
    const first = initEpoch(sessionId)
    const second = initEpoch(sessionId)
    expect(second.id).toBe(first.id)
  })

  it("addEpochMessageToSession adds message to current epoch", () => {
    const { epoch, message } = addEpochMessageToSession(sessionId, "user", "test message")
    expect(epoch.epochNumber).toBe(1)
    expect(message.content).toBe("test message")
    expect(message.role).toBe("user")
  })

  it("maybeRotateEpoch creates new epoch at threshold", () => {
    setEpochThreshold(2)
    initEpoch(sessionId)
    addEpochMessageToSession(sessionId, "user", "m1")
    addEpochMessageToSession(sessionId, "user", "m2")
    const epochs = getEpochsBySession(sessionId)
    expect(epochs.length).toBe(2)
    expect(epochs[0].epochNumber).toBe(1)
    expect(epochs[1].epochNumber).toBe(2)
  })

  it("summarizeEpoch returns role counts", () => {
    const e = createEpoch({ sessionId, epochNumber: 1 })
    addEpochMessage({ sessionId, epochId: e.id, role: "user", content: "a", sequence: 1 })
    addEpochMessage({ sessionId, epochId: e.id, role: "assistant", content: "b", sequence: 2 })
    addEpochMessage({ sessionId, epochId: e.id, role: "system", content: "c", sequence: 3 })
    const summary = summarizeEpoch(e.id)
    expect(summary).toContain("1 user")
    expect(summary).toContain("1 assistant")
    expect(summary).toContain("1 system")
    expect(summary).toContain("3 total")
  })

  it("buildContext returns compressed and current messages", () => {
    setEpochThreshold(2)
    initEpoch(sessionId)
    addEpochMessageToSession(sessionId, "user", "m1")
    addEpochMessageToSession(sessionId, "user", "m2")
    const ctx = buildContext(sessionId)
    expect(ctx.compressed).toContain("[Epoch 1]")
    expect(ctx.currentMessages).toHaveLength(0)
  })

  it("getContextStats returns stats", () => {
    setEpochThreshold(5)
    initEpoch(sessionId)
    addEpochMessageToSession(sessionId, "user", "m1")
    const stats = getContextStats(sessionId)
    expect(stats.totalEpochs).toBe(1)
    expect(stats.currentEpochNumber).toBe(1)
    expect(stats.totalMessages).toBe(1)
    expect(stats.threshold).toBe(5)
    expect(stats.epochs[0].messages).toBe(1)
  })

  it("setEpochSummarizer fires on rotation and updates baseline", async () => {
    setEpochThreshold(2)

    let capturedEpochId = ""
    let capturedMessages: Array<{role: string; content: string}> = []
    setEpochSummarizer(async (epochId: string, messages) => {
      capturedEpochId = epochId
      capturedMessages = messages
      return "LLM summary: conversation about testing"
    })

    initEpoch(sessionId)
    addEpochMessageToSession(sessionId, "user", "m1")
    addEpochMessageToSession(sessionId, "user", "m2")

    // Wait for fire-and-forget summarizer to complete
    await new Promise((r) => setTimeout(r, 100))

    const epochs = getEpochsBySession(sessionId)
    expect(epochs.length).toBe(2)

    // The first epoch should have been updated with LLM summary
    expect(epochs[0].baselineContext).toBe("LLM summary: conversation about testing")
    expect(capturedEpochId).toBe(epochs[0].id)
    expect(capturedMessages).toHaveLength(2)
  })

  it("setEpochSummarizer failure does not crash rotation", async () => {
    setEpochThreshold(2)

    setEpochSummarizer(async () => {
      throw new Error("LLM failed")
    })

    initEpoch(sessionId)
    addEpochMessageToSession(sessionId, "user", "m1")
    addEpochMessageToSession(sessionId, "user", "m2")

    await new Promise((r) => setTimeout(r, 100))

    const epochs = getEpochsBySession(sessionId)
    expect(epochs.length).toBe(2)
    // Should still have the fallback role-count baseline
    expect(epochs[0].baselineContext).toContain("2 user")
  })
})
