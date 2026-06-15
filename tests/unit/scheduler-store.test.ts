import { describe, it, expect, beforeAll, beforeEach } from "vitest"
import { createInMemoryDb } from "@arelyos/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arelyos/engine/persistence/migrate.js"
import {
  createSchedule,
  getSchedule,
  listSchedules,
  listSchedulesByWorkflow,
  updateSchedule,
  deleteSchedule,
  getDueSchedules,
  claimSchedule,
  releaseSchedule,
  recordRun,
  ScheduleRecord,
} from "@arelyos/engine/compiler/scheduler-store.js"

describe("Scheduler Store", () => {
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

  it("creates a schedule with interval mode", () => {
    const s = createSchedule("wf-1", "interval", null, 60000, db.db)
    expect(s.id).toBeTruthy()
    expect(s.workflowId).toBe("wf-1")
    expect(s.triggerMode).toBe("interval")
    expect(s.intervalMs).toBe(60000)
    expect(s.enabled).toBe(1)
    expect(s.runCount).toBe(0)
    expect(s.lockedUntil).toBeNull()
  })

  it("creates a schedule with cron mode", () => {
    const s = createSchedule("wf-2", "cron", "*/5 * * * *", null, db.db)
    expect(s.cronExpression).toBe("*/5 * * * *")
    expect(s.triggerMode).toBe("cron")
  })

  it("gets schedule by id", () => {
    const s = createSchedule("wf-3", "interval", null, 120000, db.db)
    const retrieved = getSchedule(s.id, db.db)!
    expect(retrieved.id).toBe(s.id)
    expect(retrieved.workflowId).toBe("wf-3")
  })

  it("lists all schedules", () => {
    createSchedule("wf-list-a", "interval", null, 30000, db.db)
    createSchedule("wf-list-b", "interval", null, 30000, db.db)
    const list = listSchedules(db.db)
    expect(list.length).toBeGreaterThanOrEqual(2)
  })

  it("lists schedules by workflow", () => {
    listSchedulesByWorkflow("wf-1", db.db)
    const forWf1 = listSchedulesByWorkflow("wf-1", db.db)
    expect(forWf1.length).toBeGreaterThanOrEqual(1)
    expect(forWf1.every((s: ScheduleRecord) => s.workflowId === "wf-1")).toBe(true)
  })

  it("updates a schedule", () => {
    const s = createSchedule("wf-upd", "interval", null, 60000, db.db)
    updateSchedule(s.id, { intervalMs: 120000 }, db.db)
    const retrieved = getSchedule(s.id, db.db)!
    expect(retrieved.intervalMs).toBe(120000)
  })

  it("disables a schedule", () => {
    const s = createSchedule("wf-disable", "interval", null, 60000, db.db)
    expect(s.enabled).toBe(1)
    updateSchedule(s.id, { enabled: 0 }, db.db)
    const retrieved = getSchedule(s.id, db.db)!
    expect(retrieved.enabled).toBe(0)
  })

  it("deletes a schedule", () => {
    const s = createSchedule("wf-del", "interval", null, 60000, db.db)
    deleteSchedule(s.id, db.db)
    expect(getSchedule(s.id, db.db)).toBeUndefined()
  })

  it("getDueSchedules returns due + enabled + unlocked", () => {
    const due = getDueSchedules(db.db)
    expect(Array.isArray(due)).toBe(true)
    for (const s of due) {
      expect(s.enabled).toBe(1)
    }
  })

  it("claimSchedule locks a schedule", () => {
    const s = createSchedule("wf-claim", "interval", null, 60000, db.db)
    const claimed = claimSchedule(s.id, 5000, db.db)
    expect(claimed).toBe(true)
    const retrieved = getSchedule(s.id, db.db)!
    expect(retrieved.lockedUntil).not.toBeNull()
  })

  it("cannot claim an already locked schedule", () => {
    const s = createSchedule("wf-claim-locked", "interval", null, 60000, db.db)
    claimSchedule(s.id, 5000, db.db)
    const second = claimSchedule(s.id, 5000, db.db)
    expect(second).toBe(false)
  })

  it("releaseSchedule unlocks a schedule", () => {
    const s = createSchedule("wf-release", "interval", null, 60000, db.db)
    claimSchedule(s.id, 5000, db.db)
    releaseSchedule(s.id, db.db)
    const retrieved = getSchedule(s.id, db.db)!
    expect(retrieved.lockedUntil).toBeNull()
  })

  it("recordRun updates run stats", () => {
    const s = createSchedule("wf-record-run", "interval", null, 60000, db.db)
    recordRun(s.id, true, undefined, db.db)
    const retrieved = getSchedule(s.id, db.db)!
    expect(retrieved.runCount).toBe(1)
    expect(retrieved.lastError).toBeNull()
    expect(retrieved.lastRunAt).not.toBeNull()
    expect(retrieved.lockedUntil).toBeNull()
  })

  it("recordRun with failure saves error", () => {
    const s = createSchedule("wf-record-fail", "interval", null, 60000, db.db)
    recordRun(s.id, false, "connection refused", db.db)
    const retrieved = getSchedule(s.id, db.db)!
    expect(retrieved.runCount).toBe(1)
    expect(retrieved.lastError).toBe("connection refused")
  })
})
