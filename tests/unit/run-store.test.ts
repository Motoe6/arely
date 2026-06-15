import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createInMemoryDb } from "@arelyos/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arelyos/engine/persistence/migrate.js"
import { workflows } from "@arelyos/engine/persistence/schema.js"
import {
  createRun,
  getRun,
  listRuns,
  completeRun,
  createStepRun,
  completeStepRun,
  getRunSteps,
  getRunWithSteps,
} from "@arelyos/engine/persistence/run-store.js"

describe("Workflow Run Store", () => {
  let db: ReturnType<typeof createInMemoryDb>

  beforeAll(() => {
    db = createInMemoryDb()
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

  function seedWorkflow(id: string): void {
    try {
      db.db.insert(workflows).values({ id, name: null, description: null, currentVersionId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).run()
    } catch { /* already exists */ }
  }

  beforeAll(() => {
    for (const id of ["wf-1", "wf-2", "wf-3", "wf-list", "wf-filter", "wf-limit", "wf-steps", "wf-steps-noinput", "wf-step-complete", "wf-step-fail", "wf-with-steps", "wf-all-a", "wf-all-b"]) {
      seedWorkflow(id)
    }
  })

  it("creates a run record", () => {
    const run = createRun("wf-1", 1, { input: "test" }, db.db)
    expect(run.id).toBeTruthy()
    expect(run.workflowId).toBe("wf-1")
    expect(run.workflowVersion).toBe(1)
    expect(run.status).toBe("running")
    expect(run.triggerInput).toBe(JSON.stringify({ input: "test" }))
    expect(run.startedAt).toBeTruthy()
    expect(run.completedAt).toBeNull()
    expect(run.durationMs).toBeNull()
  })

  it("creates a run without trigger input", () => {
    const run = createRun("wf-1", 2, undefined, db.db)
    expect(run.triggerInput).toBeNull()
  })

  it("retrieves a run by id", () => {
    const run = createRun("wf-2", 1, {}, db.db)
    const found = getRun(run.id, db.db)
    expect(found).toBeDefined()
    expect(found!.id).toBe(run.id)
    expect(found!.status).toBe("running")
  })

  it("returns undefined for non-existent run", () => {
    const found = getRun("nonexistent", db.db)
    expect(found).toBeUndefined()
  })

  it("completes a run with status completed", () => {
    const run = createRun("wf-3", 1, {}, db.db)
    completeRun(run.id, "completed", undefined, db.db)
    const updated = getRun(run.id, db.db)!
    expect(updated.status).toBe("completed")
    expect(updated.completedAt).toBeTruthy()
    expect(updated.durationMs).toBeTypeOf("number")
    expect(updated.error).toBeNull()
  })

  it("completes a run with status failed and error", () => {
    const run = createRun("wf-3", 1, {}, db.db)
    completeRun(run.id, "failed", "Something went wrong", db.db)
    const updated = getRun(run.id, db.db)!
    expect(updated.status).toBe("failed")
    expect(updated.error).toBe("Something went wrong")
  })

  it("lists runs ordered by startedAt desc", () => {
    const r1 = createRun("wf-list", 1, {}, db.db)
    const r2 = createRun("wf-list", 1, {}, db.db)
    const runs = listRuns({ workflowId: "wf-list" }, db.db)
    expect(runs.length).toBeGreaterThanOrEqual(2)
    expect(runs[0].startedAt >= runs[1].startedAt).toBe(true)
  })

  it("filters runs by status", () => {
    const run = createRun("wf-filter", 1, {}, db.db)
    completeRun(run.id, "completed", undefined, db.db)

    const completed = listRuns({ status: "completed" }, db.db)
    expect(completed.some((r) => r.id === run.id)).toBe(true)

    const failed = listRuns({ status: "failed" }, db.db)
    expect(failed.some((r) => r.id === run.id)).toBe(false)
  })

  it("limits the number of runs returned", () => {
    createRun("wf-limit", 1, {}, db.db)
    createRun("wf-limit", 1, {}, db.db)
    createRun("wf-limit", 1, {}, db.db)
    const limited = listRuns({ workflowId: "wf-limit", limit: 2 }, db.db)
    expect(limited.length).toBeLessThanOrEqual(2)
  })

  it("creates step run records", () => {
    const run = createRun("wf-steps", 1, {}, db.db)
    const stepRun = createStepRun(run.id, "step_a", "echo", { url: "https://example.com" }, db.db)

    expect(stepRun.id).toBeTruthy()
    expect(stepRun.runId).toBe(run.id)
    expect(stepRun.stepId).toBe("step_a")
    expect(stepRun.stepType).toBe("echo")
    expect(stepRun.status).toBe("running")
    expect(stepRun.input).toBe(JSON.stringify({ url: "https://example.com" }))
    expect(stepRun.startedAt).toBeTruthy()
    expect(stepRun.completedAt).toBeNull()
  })

  it("creates step run without input", () => {
    const run = createRun("wf-steps-noinput", 1, {}, db.db)
    const stepRun = createStepRun(run.id, "step_b", "http", undefined, db.db)
    expect(stepRun.input).toBeNull()
  })

  it("completes a step run", () => {
    const run = createRun("wf-step-complete", 1, {}, db.db)
    const stepRun = createStepRun(run.id, "step_c", "http", {}, db.db)
    completeStepRun(stepRun.id, "completed", "output data", undefined, db.db)

    const updated = getRunSteps(run.id, db.db).find((s) => s.id === stepRun.id)!
    expect(updated.status).toBe("completed")
    expect(updated.output).toBe("output data")
    expect(updated.completedAt).toBeTruthy()
    expect(updated.durationMs).toBeTypeOf("number")
  })

  it("completes a step run with failure and error", () => {
    const run = createRun("wf-step-fail", 1, {}, db.db)
    const stepRun = createStepRun(run.id, "step_d", "http", {}, db.db)
    completeStepRun(stepRun.id, "failed", undefined, "Connection refused", db.db)

    const updated = getRunSteps(run.id, db.db).find((s) => s.id === stepRun.id)!
    expect(updated.status).toBe("failed")
    expect(updated.error).toBe("Connection refused")
  })

  it("retrieves run with steps", () => {
    const run = createRun("wf-with-steps", 1, {}, db.db)
    createStepRun(run.id, "s1", "http", {}, db.db)
    createStepRun(run.id, "s2", "llm", {}, db.db)

    const full = getRunWithSteps(run.id, db.db)!
    expect(full).toBeDefined()
    expect(full.run.id).toBe(run.id)
    expect(full.steps).toHaveLength(2)
  })

  it("returns undefined for getRunWithSteps on non-existent run", () => {
    const full = getRunWithSteps("nonexistent", db.db)
    expect(full).toBeUndefined()
  })

  it("lists all runs across workflows", () => {
    createRun("wf-all-a", 1, {}, db.db)
    createRun("wf-all-b", 1, {}, db.db)

    const all = listRuns(undefined, db.db)
    expect(all.length).toBeGreaterThanOrEqual(2)
  })
})
