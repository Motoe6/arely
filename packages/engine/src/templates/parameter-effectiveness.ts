import { getFeedbackByTemplate } from "../persistence/feedback-store.js"
import type { FeedbackRecord } from "../persistence/feedback-store.js"

const CONFIDENCE_SAMPLE_SIZE = 20

export interface ParameterValueInsight {
  value: string
  executions: number
  successes: number
  failures: number
  successRate: number
  confidence: number
  weightedSuccess: number
}

export interface ParameterInsight {
  name: string
  values: ParameterValueInsight[]
}

export interface ParameterInsightsResult {
  templateId: string
  parameters: ParameterInsight[]
}

type DbClient = any

export class ParameterEffectivenessService {
  getInsights(templateId: string, db?: DbClient): ParameterInsightsResult {
    const records = getFeedbackByTemplate(templateId, db)
    const withParams = records.filter((r) => r.parameters && Object.keys(r.parameters).length > 0)
    if (withParams.length === 0) {
      return { templateId, parameters: [] }
    }

    const paramKeys = this.collectKeys(withParams)
    const insights: ParameterInsight[] = []

    for (const key of paramKeys) {
      const valueMap = this.groupByValue(withParams, key)
      const values: ParameterValueInsight[] = []

      for (const [value, entries] of Object.entries(valueMap)) {
        const executions = entries.length
        const successes = entries.filter((e) => e.success).length
        const failures = executions - successes
        const successRate = executions > 0 ? successes / executions : 0
        const confidence = Math.min(1, executions / CONFIDENCE_SAMPLE_SIZE)
        const weightedSuccess = successRate * confidence

        values.push({
          value,
          executions,
          successes,
          failures,
          successRate,
          confidence,
          weightedSuccess,
        })
      }

      values.sort((a, b) => b.weightedSuccess - a.weightedSuccess)
      insights.push({ name: key, values })
    }

    insights.sort((a, b) => {
      const aTop = a.values[0]?.weightedSuccess ?? 0
      const bTop = b.values[0]?.weightedSuccess ?? 0
      return bTop - aTop
    })

    return { templateId, parameters: insights }
  }

  private collectKeys(records: FeedbackRecord[]): string[] {
    const keySet = new Set<string>()
    for (const r of records) {
      if (r.parameters) {
        for (const key of Object.keys(r.parameters)) {
          keySet.add(key)
        }
      }
    }
    return Array.from(keySet).sort()
  }

  private groupByValue(
    records: FeedbackRecord[],
    key: string,
  ): Record<string, FeedbackRecord[]> {
    const map: Record<string, FeedbackRecord[]> = {}
    for (const r of records) {
      if (r.parameters) {
        const val = r.parameters[key]
        if (val !== undefined) {
          if (!map[val]) map[val] = []
          map[val].push(r)
        }
      }
    }
    return map
  }
}
