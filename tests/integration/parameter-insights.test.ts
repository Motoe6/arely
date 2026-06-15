import { describe, it, expect, beforeAll } from "vitest"
import { createInMemoryDb } from "@arelyos/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arelyos/engine/persistence/migrate.js"
import { createFeedback } from "@arelyos/engine/persistence/feedback-store.js"
import { ParameterEffectivenessService } from "@arelyos/engine/templates/parameter-effectiveness.js"

describe("Parameter Insights Integration", () => {
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

  it("stores and retrieves parameter feedback", () => {
    const record = createFeedback({
      workflowId: "pi-wf-1",
      templateId: "pi-tpl-1",
      source: "evolved",
      success: true,
      parameters: { interval: "5m", provider: "openrouter" },
    }, db.db)
    expect(record.parameters).toEqual({ interval: "5m", provider: "openrouter" })
  })

  it("aggregates parameter insights across multiple entries", () => {
    for (let i = 0; i < 10; i++) {
      createFeedback({
        workflowId: `pi-multi-${i}`,
        templateId: "pi-tpl-2",
        source: "evolved",
        success: i < 8,
        parameters: { interval: i < 6 ? "5m" : "1m" },
      }, db.db)
    }

    const svc = new ParameterEffectivenessService()
    const insights = svc.getInsights("pi-tpl-2", db.db)
    expect(insights.templateId).toBe("pi-tpl-2")
    expect(insights.parameters).toHaveLength(1)
    expect(insights.parameters[0].name).toBe("interval")

    const vals = insights.parameters[0].values
    expect(vals).toHaveLength(2)

    const fiveM = vals.find((v) => v.value === "5m")
    expect(fiveM).toBeDefined()
    expect(fiveM!.executions).toBe(6)
    expect(fiveM!.successes).toBe(6)
    expect(fiveM!.confidence).toBe(0.3)

    const oneM = vals.find((v) => v.value === "1m")
    expect(oneM).toBeDefined()
    expect(oneM!.executions).toBe(4)
    expect(oneM!.successes).toBe(2)
  })

  it("returns empty for template with no parameter feedback", () => {
    createFeedback({
      workflowId: "pi-no-param",
      templateId: "pi-tpl-no-param",
      source: "manual",
      success: true,
    }, db.db)

    const svc = new ParameterEffectivenessService()
    const insights = svc.getInsights("pi-tpl-no-param", db.db)
    expect(insights.parameters).toEqual([])
  })

  it("sorts values by weightedSuccess descending", () => {
    for (let i = 0; i < 25; i++) {
      createFeedback({
        workflowId: `pi-sort-${i}`,
        templateId: "pi-tpl-sort",
        source: "evolved",
        success: i < 20,
        parameters: { mode: i < 15 ? "fast" : "slow" },
      }, db.db)
    }

    const svc = new ParameterEffectivenessService()
    const insights = svc.getInsights("pi-tpl-sort", db.db)
    const vals = insights.parameters[0].values
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i - 1].weightedSuccess).toBeGreaterThanOrEqual(vals[i].weightedSuccess)
    }
  })
})
