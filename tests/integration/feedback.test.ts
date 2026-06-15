import { describe, it, expect, beforeAll } from "vitest"
import { createInMemoryDb } from "@arely/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arely/engine/persistence/migrate.js"
import {
  createFeedback,
  getFeedbackByWorkflow,
  getTemplateMetrics,
} from "@arely/engine/persistence/feedback-store.js"
import { TemplateMetricsService } from "@arely/engine/templates/template-metrics.js"

describe("Feedback Integration", () => {
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

  it("submits feedback and retrieves it by workflow", () => {
    const record = createFeedback({
      workflowId: "integ-wf-1",
      templateId: "integ-tpl-1",
      source: "evolved",
      success: true,
      durationMs: 2000,
    }, db.db)
    expect(record.id).toBeTruthy()

    const records = getFeedbackByWorkflow("integ-wf-1", db.db)
    expect(records).toHaveLength(1)
    expect(records[0].templateId).toBe("integ-tpl-1")
    expect(records[0].success).toBe(true)
    expect(records[0].durationMs).toBe(2000)
    expect(records[0].source).toBe("evolved")
  })

  it("tracks template metrics across multiple feedback entries", () => {
    for (let i = 0; i < 5; i++) {
      createFeedback({
        workflowId: `integ-multi-${i}`,
        templateId: "integ-tpl-multi",
        source: "evolved",
        success: i < 4,
        durationMs: 1000 + i * 100,
      }, db.db)
    }

    const metrics = getTemplateMetrics(db.db)
    const m = metrics.find((x) => x.templateId === "integ-tpl-multi")
    expect(m).toBeDefined()
    expect(m!.executions).toBe(5)
    expect(m!.successes).toBe(4)
    expect(m!.failures).toBe(1)
    expect(m!.successRate).toBe(0.8)
    expect(m!.avgDuration).toBeCloseTo(1200, -1)
  })

  it("produces confidence-weighted metrics via service", () => {
    const getMetrics = vi.fn().mockReturnValue([
      { templateId: "integ-tpl-weighted", executions: 10, successes: 8, failures: 2, successRate: 0.8, avgDuration: 500 },
    ])
    const svc = new TemplateMetricsService({ getMetrics })
    const all = svc.getAllRanked()
    expect(all[0].confidence).toBe(0.5)
    expect(all[0].weightedSuccess).toBe(0.4)
    expect(all[0].weightedSuccess).toBeLessThanOrEqual(all[0].successRate)
  })
})
