import { describe, it, expect, beforeAll } from "vitest"
import { createInMemoryDb } from "@arely/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arely/engine/persistence/migrate.js"
import { createFeedback } from "@arely/engine/persistence/feedback-store.js"
import { EvolutionProposalService } from "@arely/engine/evolution/evolution-proposal-service.js"
import { ParameterRecommenderService } from "@arely/engine/templates/parameter-recommender.js"
import { ParameterEffectivenessService } from "@arely/engine/templates/parameter-effectiveness.js"

describe("Evolution Proposals Integration", () => {
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

  it("generates proposals for a template with sufficient high-quality feedback", () => {
    for (let i = 0; i < 25; i++) {
      createFeedback({
        workflowId: `ep-succ-${i}`,
        templateId: "ep-tpl-1",
        source: "evolved",
        success: true,
        parameters: { interval: "300" },
      }, db.db)
    }
    for (let i = 0; i < 5; i++) {
      createFeedback({
        workflowId: `ep-fail-${i}`,
        templateId: "ep-tpl-1",
        source: "evolved",
        success: false,
        parameters: { interval: "60" },
      }, db.db)
    }

    const recommender = new ParameterRecommenderService()
    const effectivenessService = new ParameterEffectivenessService()
    const svc = new EvolutionProposalService(recommender, effectivenessService)
    const result = svc.getProposals("ep-tpl-1", db.db)

    expect(result.templateId).toBe("ep-tpl-1")
    expect(result.proposals.length).toBeGreaterThanOrEqual(1)

    const proposal = result.proposals.find((p) => p.parameter === "interval")
    expect(proposal).toBeDefined()
    expect(proposal!.type).toBe("parameter_change")
    expect(proposal!.suggestedValue).toBe("300")
    expect(proposal!.currentValue).toBe("60")
    expect(proposal!.confidence).toBeGreaterThanOrEqual(0.6)
    expect(proposal!.evidence.executions).toBeGreaterThanOrEqual(20)
    expect(proposal!.evidence.successRate).toBeGreaterThan(0.8)
    expect(proposal!.id).toMatch(/^evo_/)
  })

  it("returns empty proposals for template with no feedback", () => {
    const recommender = new ParameterRecommenderService()
    const effectivenessService = new ParameterEffectivenessService()
    const svc = new EvolutionProposalService(recommender, effectivenessService)
    const result = svc.getProposals("ep-tpl-nonexistent", db.db)

    expect(result.templateId).toBe("ep-tpl-nonexistent")
    expect(result.proposals).toEqual([])
  })

  it("generates multiple proposals for multiple parameters", () => {
    for (let i = 0; i < 25; i++) {
      createFeedback({
        workflowId: `ep-multi-interval-${i}`,
        templateId: "ep-tpl-multi",
        source: "evolved",
        success: i < 23,
        parameters: { interval: "300", timeout: "5000" },
      }, db.db)
    }
    for (let i = 0; i < 5; i++) {
      createFeedback({
        workflowId: `ep-multi-alt-${i}`,
        templateId: "ep-tpl-multi",
        source: "evolved",
        success: false,
        parameters: { interval: "600", timeout: "1000" },
      }, db.db)
    }

    const recommender = new ParameterRecommenderService()
    const effectivenessService = new ParameterEffectivenessService()
    const svc = new EvolutionProposalService(recommender, effectivenessService)
    const result = svc.getProposals("ep-tpl-multi", db.db)

    expect(result.templateId).toBe("ep-tpl-multi")
    expect(result.proposals.length).toBeGreaterThanOrEqual(1)

    const paramNames = result.proposals.map((p) => p.parameter)
    expect(paramNames).toContain("interval")
    expect(paramNames).toContain("timeout")
  })
})
