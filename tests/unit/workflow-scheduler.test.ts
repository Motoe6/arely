import { describe, it, expect, beforeAll, vi } from "vitest"
import { createInMemoryDb } from "@arelyos/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arelyos/engine/persistence/migrate.js"
import { createSchedule } from "@arelyos/engine/compiler/scheduler-store.js"
import { WorkflowScheduler } from "@arelyos/engine/compiler/workflow-scheduler.js"

describe("WorkflowScheduler", () => {
  let db: ReturnType<typeof createInMemoryDb>

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
  })

  it("start and stop without errors", () => {
    const mockBuilder = { execute: vi.fn().mockResolvedValue({ success: true, runId: "run-1", steps: [] }) }
    const scheduler = new WorkflowScheduler(mockBuilder as any, 60000)
    expect(scheduler.isRunning()).toBe(false)
    scheduler.start()
    expect(scheduler.isRunning()).toBe(true)
    scheduler.stop()
    expect(scheduler.isRunning()).toBe(false)
  })

  it("emits started and stopped events", () => {
    const mockBuilder = { execute: vi.fn() }
    const scheduler = new WorkflowScheduler(mockBuilder as any, 60000)
    const startedSpy = vi.fn()
    const stoppedSpy = vi.fn()
    scheduler.on("started", startedSpy)
    scheduler.on("stopped", stoppedSpy)
    scheduler.start()
    scheduler.stop()
    expect(startedSpy).toHaveBeenCalledOnce()
    expect(stoppedSpy).toHaveBeenCalledOnce()
  })

  it("executes due schedules on tick", async () => {
    createSchedule("wf-exec", "interval", null, 100, db.db)
    const mockBuilder = { execute: vi.fn().mockResolvedValue({ success: true, runId: "run-1", steps: [] }) }
    const scheduler = new WorkflowScheduler(mockBuilder as any, 100, db.db)
    const executeSpy = vi.fn()
    scheduler.on("execute", executeSpy)
    scheduler.start()
    await vi.waitFor(() => {
      expect(executeSpy).toHaveBeenCalled()
    }, { timeout: 5000, interval: 100 })
    scheduler.stop()
  })

  it("emits scheduleError when execute fails", async () => {
    createSchedule("wf-fail", "interval", null, 100, db.db)
    const mockBuilder = { execute: vi.fn().mockRejectedValue(new Error("timeout")) }
    const scheduler = new WorkflowScheduler(mockBuilder as any, 100, db.db)
    const errorSpy = vi.fn()
    scheduler.on("scheduleError", errorSpy)
    scheduler.start()
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalled()
    }, { timeout: 5000, interval: 100 })
    scheduler.stop()
  })

  it("double start is no-op", () => {
    const mockBuilder = { execute: vi.fn() }
    const scheduler = new WorkflowScheduler(mockBuilder as any, 60000)
    const startedSpy = vi.fn()
    scheduler.on("started", startedSpy)
    scheduler.start()
    scheduler.start()
    expect(startedSpy).toHaveBeenCalledOnce()
    scheduler.stop()
  })
})
