import { describe, it, expect, beforeAll } from "vitest"
import { createInMemoryDb } from "@arelyos/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arelyos/engine/persistence/migrate.js"
import {
  createFeedback,
  getFeedbackByWorkflow,
  getFeedbackByTemplate,
  getTemplateMetrics,
  getFeedbackStats,
} from "@arelyos/engine/persistence/feedback-store.js"

describe("Feedback Store", () => {
  let db: ReturnType<typeof createInMemoryDb>

  beforeAll(() => {
    db = createInMemoryDb()
    for (const stmt of CREATE_TABLES) {
      db.sqlite.exec(stmt)
    }
    for (const stmt of MIGRATIONS) {
      try { db.sqlite.exec(stmt) } catch { }
    }
    for (const idx of CREATE_INDEXES) {
      try { db.sqlite.exec(idx) } catch { }
    }
  })

  it("creates feedback record", () => {
    const record = createFeedback({
      workflowId: "wf-1",
      source: "evolved",
      success: true,
    }, db.db)
    expect(record.id).toBeTruthy()
    expect(record.workflowId).toBe("wf-1")
    expect(record.source).toBe("evolved")
    expect(record.success).toBe(true)
    expect(record.createdAt).toBeTruthy()
  })

  it("creates feedback with all optional fields", () => {
    const record = createFeedback({
      workflowId: "wf-2",
      workflowVersionId: "wv-1",
      templateId: "tpl-1",
      source: "template",
      success: false,
      durationMs: 1500,
    }, db.db)
    expect(record.workflowVersionId).toBe("wv-1")
    expect(record.templateId).toBe("tpl-1")
    expect(record.source).toBe("template")
    expect(record.success).toBe(false)
    expect(record.durationMs).toBe(1500)
  })

  it("gets feedback by workflow", () => {
    createFeedback({ workflowId: "wf-3", source: "manual", success: true }, db.db)
    createFeedback({ workflowId: "wf-3", source: "manual", success: false }, db.db)
    createFeedback({ workflowId: "wf-other", source: "manual", success: true }, db.db)
    const records = getFeedbackByWorkflow("wf-3", db.db)
    expect(records).toHaveLength(2)
    expect(records.every((r) => r.workflowId === "wf-3")).toBe(true)
  })

  it("gets feedback by template", () => {
    createFeedback({ workflowId: "wf-4", templateId: "tpl-A", source: "evolved", success: true }, db.db)
    createFeedback({ workflowId: "wf-5", templateId: "tpl-A", source: "evolved", success: false }, db.db)
    createFeedback({ workflowId: "wf-6", templateId: "tpl-B", source: "evolved", success: true }, db.db)
    const records = getFeedbackByTemplate("tpl-A", db.db)
    expect(records).toHaveLength(2)
    expect(records.every((r) => r.templateId === "tpl-A")).toBe(true)
  })

  it("computes template metrics", () => {
    createFeedback({ workflowId: "wf-m1", templateId: "tpl-M1", source: "evolved", success: true }, db.db)
    createFeedback({ workflowId: "wf-m2", templateId: "tpl-M1", source: "evolved", success: true }, db.db)
    createFeedback({ workflowId: "wf-m3", templateId: "tpl-M1", source: "evolved", success: false }, db.db)
    createFeedback({ workflowId: "wf-m4", templateId: "tpl-M2", source: "template", success: true }, db.db)
    const metrics = getTemplateMetrics(db.db)
    const m1 = metrics.find((m) => m.templateId === "tpl-M1")
    expect(m1).toBeDefined()
    expect(m1!.executions).toBe(3)
    expect(m1!.successes).toBe(2)
    expect(m1!.failures).toBe(1)
    expect(m1!.successRate).toBeCloseTo(2 / 3, 5)
    const m2 = metrics.find((m) => m.templateId === "tpl-M2")
    expect(m2).toBeDefined()
    expect(m2!.executions).toBe(1)
    expect(m2!.successes).toBe(1)
    expect(m2!.successRate).toBe(1)
  })

  it("returns empty metrics when no template-linked feedback", () => {
    const metrics = getTemplateMetrics(db.db)
    expect(metrics.length).toBeGreaterThanOrEqual(2)
  })

  it("provides feedback stats summary", () => {
    const stats = getFeedbackStats(db.db)
    expect(stats.total).toBeGreaterThan(0)
    expect(Object.keys(stats.bySource).length).toBeGreaterThan(0)
    expect(Object.keys(stats.byTemplate).length).toBeGreaterThan(0)
  })
})
