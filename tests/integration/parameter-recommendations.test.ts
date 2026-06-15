import { describe, it, expect, beforeAll } from "vitest"
import { createInMemoryDb } from "@arely/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arely/engine/persistence/migrate.js"
import { createFeedback } from "@arely/engine/persistence/feedback-store.js"
import { ParameterRecommenderService } from "@arely/engine/templates/parameter-recommender.js"

describe("Parameter Recommendations Integration", () => {
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

  it("returns recommendations for a template with sufficient execution data", () => {
    for (let i = 0; i < 20; i++) {
      createFeedback({
        workflowId: `pr-rec-${i}`,
        templateId: "pr-tpl-1",
        source: "evolved",
        success: i < 18,
        parameters: { interval: "300", timeout: "5000" },
      }, db.db)
    }
    for (let i = 0; i < 5; i++) {
      createFeedback({
        workflowId: `pr-rec-alt-${i}`,
        templateId: "pr-tpl-1",
        source: "evolved",
        success: i < 2,
        parameters: { interval: "600", timeout: "1000" },
      }, db.db)
    }

    const svc = new ParameterRecommenderService()
    const result = svc.getRecommendations("pr-tpl-1", db.db)

    expect(result.templateId).toBe("pr-tpl-1")
    expect(result.recommendations.length).toBeGreaterThanOrEqual(1)

    const intervalRec = result.recommendations.find((r) => r.parameter === "interval")
    expect(intervalRec).toBeDefined()
    expect(intervalRec!.suggestedValue).toBe("300")
    expect(intervalRec!.executions).toBe(20)
    expect(intervalRec!.score).toBeGreaterThan(0)

    expect(intervalRec!.evidence).toMatch(/20 executions/)
  })

  it("returns empty recommendations for template with insufficient data", () => {
    for (let i = 0; i < 3; i++) {
      createFeedback({
        workflowId: `pr-insuf-${i}`,
        templateId: "pr-tpl-insuf",
        source: "evolved",
        success: i < 2,
        parameters: { mode: "fast" },
      }, db.db)
    }

    const svc = new ParameterRecommenderService()
    const result = svc.getRecommendations("pr-tpl-insuf", db.db)

    expect(result.templateId).toBe("pr-tpl-insuf")
    expect(result.recommendations).toEqual([])
  })

  it("returns empty for template with no feedback at all", () => {
    const svc = new ParameterRecommenderService()
    const result = svc.getRecommendations("pr-tpl-nonexistent", db.db)

    expect(result.templateId).toBe("pr-tpl-nonexistent")
    expect(result.recommendations).toEqual([])
  })

  it("sorts recommendations by score descending", () => {
    for (let i = 0; i < 10; i++) {
      createFeedback({
        workflowId: `pr-sort-interval-${i}`,
        templateId: "pr-tpl-sort",
        source: "evolved",
        success: true,
        parameters: { interval: "300" },
      }, db.db)
    }
    createFeedback({
      workflowId: "pr-sort-interval-bad",
      templateId: "pr-tpl-sort",
      source: "evolved",
      success: false,
      parameters: { interval: "600" },
    }, db.db)

    const svc = new ParameterRecommenderService()
    const result = svc.getRecommendations("pr-tpl-sort", db.db)

    expect(result.recommendations.length).toBeGreaterThanOrEqual(1)
    for (let i = 1; i < result.recommendations.length; i++) {
      expect(result.recommendations[i - 1].score).toBeGreaterThanOrEqual(result.recommendations[i].score)
    }
  })
})
