import { ParameterEffectivenessService } from "./parameter-effectiveness.js"
import type { ParameterInsight } from "./parameter-effectiveness.js"

const MIN_EXECUTIONS = 5
const MIN_CONFIDENCE = 0.25
const MIN_SUCCESS_RATE = 0.6

export interface ParameterRecommendation {
  parameter: string
  suggestedValue: string
  successRate: number
  confidence: number
  executions: number
  score: number
  evidence: string
}

export interface ParameterRecommendationsResult {
  templateId: string
  recommendations: ParameterRecommendation[]
}

type DbClient = any

export class ParameterRecommenderService {
  private effectivenessService: ParameterEffectivenessService

  constructor(effectivenessService?: ParameterEffectivenessService) {
    this.effectivenessService = effectivenessService ?? new ParameterEffectivenessService()
  }

  getRecommendations(templateId: string, db?: DbClient): ParameterRecommendationsResult {
    const insights = this.effectivenessService.getInsights(templateId, db)
    if (insights.parameters.length === 0) {
      return { templateId, recommendations: [] }
    }

    const recommendations: ParameterRecommendation[] = []

    for (const param of insights.parameters) {
      const candidate = this.bestCandidate(param)
      if (candidate) {
        recommendations.push(candidate)
      }
    }

    recommendations.sort((a, b) => b.score - a.score)

    return { templateId, recommendations }
  }

  private bestCandidate(param: ParameterInsight): ParameterRecommendation | null {
    let best: ParameterRecommendation | null = null

    for (const val of param.values) {
      if (val.executions < MIN_EXECUTIONS) continue
      if (val.confidence < MIN_CONFIDENCE) continue
      if (val.successRate < MIN_SUCCESS_RATE) continue

      const score = val.successRate * val.confidence * val.confidence
      const evidence = `${val.executions} executions, ${Math.round(val.successRate * 100)}% success rate`

      const rec: ParameterRecommendation = {
        parameter: param.name,
        suggestedValue: val.value,
        successRate: val.successRate,
        confidence: val.confidence,
        executions: val.executions,
        score,
        evidence,
      }

      if (!best || score > best.score) {
        best = rec
      }
    }

    return best
  }
}
