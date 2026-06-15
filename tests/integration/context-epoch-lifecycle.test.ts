import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { initTestDb, cleanupTestDb } from "../setup.js"
import { createSession } from "@arely/engine/persistence/session-store.js"
import {
  createEpoch,
  getEpochsBySession,
  getCurrentEpoch,
  addEpochMessage,
  getEpochMessages,
  updateEpoch,
  getEpoch,
} from "@arely/engine/persistence/context-epoch-store.js"
import {
  initEpoch,
  addEpochMessageToSession,
  buildContext,
  setEpochThreshold,
} from "@arely/engine/llm/context-epoch-service.js"

let sessionId: string

beforeEach(() => {
  initTestDb()
  const session = createSession({ query: "lifecycle-test", model: "test", toolMode: "native" })
  sessionId = session.id
})

afterEach(() => {
  cleanupTestDb()
})

describe("Context Epoch Lifecycle", () => {
  it("full multi-epoch lifecycle with rotation", () => {
    setEpochThreshold(3)

    const ep1 = initEpoch(sessionId)
    expect(ep1.epochNumber).toBe(1)

    addEpochMessageToSession(sessionId, "user", "q1")
    addEpochMessageToSession(sessionId, "user", "q2")
    addEpochMessageToSession(sessionId, "user", "q3")

    const epochs = getEpochsBySession(sessionId)
    expect(epochs).toHaveLength(2)

    expect(epochs[0].baselineContext).toContain("3 user")
    expect(epochs[0].messageCount).toBe(3)

    expect(epochs[1].epochNumber).toBe(2)
    expect(epochs[1].messageCount).toBe(0)
    expect(getCurrentEpoch(sessionId)!.epochNumber).toBe(2)
  })

  it("buildContext returns compressed older epoch and current messages", () => {
    setEpochThreshold(2)

    initEpoch(sessionId)
    addEpochMessageToSession(sessionId, "user", "first")
    addEpochMessageToSession(sessionId, "assistant", "second")

    const ctx = buildContext(sessionId)
    expect(ctx.compressed).toContain("[Epoch 1]")
    expect(ctx.compressed).toContain("1 user")
    expect(ctx.compressed).toContain("1 assistant")
    expect(ctx.currentMessages).toHaveLength(0)
  })

  it("messages remain in correct epoch after rotation", () => {
    setEpochThreshold(3)

    initEpoch(sessionId)
    addEpochMessageToSession(sessionId, "user", "epoch1-msg1")
    addEpochMessageToSession(sessionId, "user", "epoch1-msg2")

    let current = getCurrentEpoch(sessionId)
    expect(current!.epochNumber).toBe(1)

    addEpochMessageToSession(sessionId, "user", "epoch1-msg3")

    current = getCurrentEpoch(sessionId)
    expect(current!.epochNumber).toBe(2)

    addEpochMessageToSession(sessionId, "assistant", "epoch2-msg1")

    const epochs = getEpochsBySession(sessionId)
    const e1 = epochs.find((e) => e.epochNumber === 1)!
    const e2 = epochs.find((e) => e.epochNumber === 2)!
    expect(e1.messageCount).toBe(3)
    expect(e2.messageCount).toBe(1)

    const e1Messages = getEpochMessages(e1.id)
    const e2Messages = getEpochMessages(e2.id)
    expect(e1Messages).toHaveLength(3)
    expect(e2Messages).toHaveLength(1)
    expect(e2Messages[0].content).toBe("epoch2-msg1")
  })

  it("epoch persistence survives store operations", () => {
    setEpochThreshold(5)

    const epoch = createEpoch({ sessionId, epochNumber: 1 })
    addEpochMessage({ sessionId, epochId: epoch.id, role: "user", content: "persist", sequence: 1 })
    addEpochMessage({ sessionId, epochId: epoch.id, role: "assistant", content: "test", sequence: 2 })

    updateEpoch(epoch.id, { baselineContext: "custom summary" })

    const refreshed = getEpoch(epoch.id)
    expect(refreshed).not.toBeNull()
    expect(refreshed!.baselineContext).toBe("custom summary")
  })
})
