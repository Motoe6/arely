import { describe, it, expect, beforeAll, vi } from "vitest"
import { createInMemoryDb } from "@arely/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arely/engine/persistence/migrate.js"
import { createWorkflow, createWorkflowVersion, getWorkflowWithCurrentVersion } from "@arely/engine/persistence/workflow-store.js"
import { createRun, createStepRun, completeStepRun, completeRun, getRunWithSteps } from "@arely/engine/persistence/run-store.js"
import { globalNodeRegistry } from "@arely/flow-sdk"

// Register a simple mock node
import type { NodeDefinition } from "@arely/flow-sdk"

describe("Replay Service", () => {
  let db: ReturnType<typeof createInMemoryDb>
  let wfId: string

  beforeAll(() => {
    db = createInMemoryDb()
    db.sqlite.exec("PRAGMA foreign_keys = OFF")
    for (const stmt of CREATE_TABLES) {
      db.sqlite.exec(stmt)
    }
    for (const stmt of MIGRATIONS) {
      try { db.sqlite.exec(stmt) } catch { /* may already exist */ }
    }
    for (const idx of CREATE_INDEXES) {
      try { db.sqlite.exec(idx) } catch { /* column may not exist */ }
    }

    // Register a mock echo node for testing
    if (!globalNodeRegistry.has("test_echo")) {
      globalNodeRegistry.register({
        type: "test_echo",
        label: "Test Echo",
        category: "action",
        inputSchema: {},
        async execute(_ctx: any, input: any) {
          return { echoed: input?.message ?? "hello" }
        },
      } as NodeDefinition)
    }

    // Create a workflow with a known DSL
    const record = createWorkflow({ name: "replay-test-wf" }, db.db)
    wfId = record.id
    createWorkflowVersion(wfId, JSON.stringify({
      id: wfId,
      name: "replay-test-wf",
      version: "1.0.0",
      steps: [
        { id: "step1", type: "test_echo", input: { message: "first" }, next: "step2" },
        { id: "step2", type: "test_echo", input: { message: "second" }, next: "step3" },
        { id: "step3", type: "test_echo", input: { message: "third" } },
      ],
    }), "active", db.db)
  })

  it("replayRun creates a new run with replayOf metadata", async () => {
    // Create a completed original run
    const wfEntry = getWorkflowWithCurrentVersion(wfId, db.db)!
    const originalRun = createRun(wfId, wfEntry.version.version, { source: "test" }, db.db)
    const s1 = createStepRun(originalRun.id, "step1", "test_echo", { message: "first" }, db.db)
    completeStepRun(s1.id, "completed", JSON.stringify({ echoed: "first" }), undefined, db.db)
    const s2 = createStepRun(originalRun.id, "step2", "test_echo", { message: "second" }, db.db)
    completeStepRun(s2.id, "completed", JSON.stringify({ echoed: "second" }), undefined, db.db)
    const s3 = createStepRun(originalRun.id, "step3", "test_echo", { message: "third" }, db.db)
    completeStepRun(s3.id, "completed", JSON.stringify({ echoed: "third" }), undefined, db.db)
    completeRun(originalRun.id, "completed", undefined, db.db)

    // Import and call replayRun
    const { replayRun } = await import("@arely/engine/compiler/replay-service.js")
    const result = await replayRun(originalRun.id, undefined, db.db)

    expect(result.success).toBe(true)
    expect(result.runId).toBeTruthy()
    expect(result.runId).not.toBe(originalRun.id)
    expect(result.steps).toHaveLength(3)

    // Verify the new run has replayOfRunId
    const newRun = getRunWithSteps(result.runId, db.db)!
    expect(newRun.run.status).toBe("completed")
    expect((newRun.run as any).replayOfRunId as string).toBe(originalRun.id)
  })

  it("returns not found for non-existent run", async () => {
    const { replayRun } = await import("@arely/engine/compiler/replay-service.js")
    const result = await replayRun("nonexistent-run", undefined, db.db)
    expect(result.success).toBe(false)
    expect(result.error).toContain("not found")
  })

  it("replayFromStep replays from a specific step", async () => {
    const wfEntry = getWorkflowWithCurrentVersion(wfId, db.db)!
    const originalRun = createRun(wfId, wfEntry.version.version, {}, db.db)
    const s1 = createStepRun(originalRun.id, "step1", "test_echo", { message: "first" }, db.db)
    completeStepRun(s1.id, "completed", JSON.stringify({ echoed: "first" }), undefined, db.db)
    const s2 = createStepRun(originalRun.id, "step2", "test_echo", { message: "second" }, db.db)
    completeStepRun(s2.id, "completed", JSON.stringify({ echoed: "second" }), undefined, db.db)
    const s3 = createStepRun(originalRun.id, "step3", "test_echo", { message: "third" }, db.db)
    completeStepRun(s3.id, "completed", JSON.stringify({ echoed: "third" }), undefined, db.db)
    completeRun(originalRun.id, "completed", undefined, db.db)

    const { replayFromStep } = await import("@arely/engine/compiler/replay-service.js")
    const result = await replayFromStep(originalRun.id, "step3", { triggerInput: {} }, db.db)

    expect(result.success).toBe(true)
    expect(result.steps).toHaveLength(3)
    // Step1 and step2 should be from original run's outputs, step3 should be freshly executed
    const newRun = getRunWithSteps(result.runId, db.db)!
    expect((newRun.run as any).replayOfRunId as string).toBe(originalRun.id)
    expect((newRun.run as any).replayFromStepId as string).toBe("step3")
  })
})
