import { describe, it, expect, vi } from "vitest"
import { TemplateMetricsService } from "@arely/engine/templates/template-metrics.js"

describe("TemplateMetricsService", () => {
  it("returns empty when no metrics", () => {
    const getMetrics = vi.fn().mockReturnValue([])
    const svc = new TemplateMetricsService({ getMetrics })
    expect(svc.getAllRanked()).toEqual([])
  })

  it("returns all ranked metrics with confidence and weightedSuccess", () => {
    const getMetrics = vi.fn().mockReturnValue([
      { templateId: "tpl-A", executions: 10, successes: 8, failures: 2, successRate: 0.8, avgDuration: 500 },
      { templateId: "tpl-B", executions: 5, successes: 3, failures: 2, successRate: 0.6, avgDuration: 1000 },
    ])
    const svc = new TemplateMetricsService({ getMetrics })
    const all = svc.getAllRanked()
    expect(all).toHaveLength(2)
    expect(all[0].templateId).toBe("tpl-A")
    expect(all[0].successRate).toBe(0.8)
    expect(all[0].confidence).toBe(0.5)
    expect(all[0].weightedSuccess).toBe(0.4)
    expect(all[0].avgDurationMs).toBe(500)
  })

  it("computes confidence=0.05 for 1 execution at 100% success", () => {
    const getMetrics = vi.fn().mockReturnValue([
      { templateId: "tpl-1", executions: 1, successes: 1, failures: 0, successRate: 1.0, avgDuration: null },
    ])
    const svc = new TemplateMetricsService({ getMetrics })
    const all = svc.getAllRanked()
    expect(all[0].confidence).toBe(0.05)
    expect(all[0].weightedSuccess).toBe(0.05)
  })

  it("computes confidence=0.5 for 10 executions at 90% success", () => {
    const getMetrics = vi.fn().mockReturnValue([
      { templateId: "tpl-10", executions: 10, successes: 9, failures: 1, successRate: 0.9, avgDuration: null },
    ])
    const svc = new TemplateMetricsService({ getMetrics })
    const all = svc.getAllRanked()
    expect(all[0].confidence).toBe(0.5)
    expect(all[0].weightedSuccess).toBe(0.45)
  })

  it("computes confidence=1.0 for 20 executions at 90% success", () => {
    const getMetrics = vi.fn().mockReturnValue([
      { templateId: "tpl-20", executions: 20, successes: 18, failures: 2, successRate: 0.9, avgDuration: null },
    ])
    const svc = new TemplateMetricsService({ getMetrics })
    const all = svc.getAllRanked()
    expect(all[0].confidence).toBe(1.0)
    expect(all[0].weightedSuccess).toBe(0.9)
  })

  it("computes confidence=1.0 for 100 executions at 90% success", () => {
    const getMetrics = vi.fn().mockReturnValue([
      { templateId: "tpl-100", executions: 100, successes: 90, failures: 10, successRate: 0.9, avgDuration: null },
    ])
    const svc = new TemplateMetricsService({ getMetrics })
    const all = svc.getAllRanked()
    expect(all[0].confidence).toBe(1.0)
    expect(all[0].weightedSuccess).toBe(0.9)
  })

  it("ensures weightedSuccess never exceeds successRate", () => {
    const scenarios = [1, 5, 10, 20, 50, 100, 1000]
    for (const executions of scenarios) {
      const getMetrics = vi.fn().mockReturnValue([
        { templateId: "tpl-x", executions, successes: Math.floor(executions * 0.8), failures: Math.ceil(executions * 0.2), successRate: 0.8, avgDuration: null },
      ])
      const svc = new TemplateMetricsService({ getMetrics })
      const all = svc.getAllRanked()
      expect(all[0].weightedSuccess).toBeLessThanOrEqual(all[0].successRate)
    }
  })

  it("gets effectiveness for specific template", () => {
    const getMetrics = vi.fn().mockReturnValue([
      { templateId: "tpl-A", executions: 10, successes: 8, failures: 2, successRate: 0.8, avgDuration: 500 },
    ])
    const svc = new TemplateMetricsService({ getMetrics })
    const m = svc.getEffectiveness("tpl-A")
    expect(m).toBeDefined()
    expect(m!.executions).toBe(10)
    expect(m!.successRate).toBe(0.8)
    expect(m!.confidence).toBe(0.5)
    expect(m!.weightedSuccess).toBe(0.4)
  })

  it("returns null for unknown template", () => {
    const getMetrics = vi.fn().mockReturnValue([])
    const svc = new TemplateMetricsService({ getMetrics })
    expect(svc.getEffectiveness("nonexistent")).toBeNull()
  })
})
