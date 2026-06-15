import type { TemplateMetricsRow } from "../persistence/feedback-store.js"
import { getTemplateMetrics } from "../persistence/feedback-store.js"

const CONFIDENCE_SAMPLE_SIZE = 20

export interface TemplateEffectiveness {
  templateId: string
  executions: number
  successes: number
  failures: number
  successRate: number
  confidence: number
  weightedSuccess: number
  avgDurationMs: number | null
}

export class TemplateMetricsService {
  constructor(
    private options?: {
      getMetrics?: typeof getTemplateMetrics
    },
  ) {}

  getEffectiveness(templateId: string): TemplateEffectiveness | null {
    const all = this.getAllRanked()
    return all.find((m) => m.templateId === templateId) ?? null
  }

  getAllRanked(): TemplateEffectiveness[] {
    const fn = this.options?.getMetrics ?? getTemplateMetrics
    const rows = fn()
    return rows.map((r: TemplateMetricsRow) => {
      const confidence = Math.min(1, r.executions / CONFIDENCE_SAMPLE_SIZE)
      const weightedSuccess = r.successRate * confidence
      return {
        templateId: r.templateId,
        executions: r.executions,
        successes: r.successes,
        failures: r.failures,
        successRate: r.successRate,
        confidence,
        weightedSuccess,
        avgDurationMs: r.avgDuration,
      }
    })
  }
}
