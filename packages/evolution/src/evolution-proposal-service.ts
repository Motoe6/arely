import { ulid } from "ulid"
import type { ParameterRecommenderLike, ParameterEffectivenessLike } from "./types.js"
import type { EvolutionProposal, EvolutionProposalsResult } from "./evolution-types.js"

const MIN_RECOMMENDATION_SCORE = 0.6
const MIN_RECOMMENDATION_EXECUTIONS = 20

type DbClient = any

export class EvolutionProposalService {
  constructor(
    private recommender: ParameterRecommenderLike,
    private effectivenessService: ParameterEffectivenessLike,
  ) {}

  getProposals(templateId: string, db?: DbClient): EvolutionProposalsResult {
    const recs = this.recommender.getRecommendations(templateId, db)
    if (recs.recommendations.length === 0) {
      return { templateId, proposals: [] }
    }

    const insights = this.effectivenessService.getInsights(templateId, db)
    const proposals: EvolutionProposal[] = []

    for (const rec of recs.recommendations) {
      if (rec.score < MIN_RECOMMENDATION_SCORE) continue
      if (rec.executions < MIN_RECOMMENDATION_EXECUTIONS) continue

      const currentValue = this.findAlternativeValue(insights.parameters, rec.parameter, rec.suggestedValue)

      proposals.push({
        id: `evo_${ulid()}`,
        templateId,
        type: "parameter_change",
        parameter: rec.parameter,
        currentValue,
        suggestedValue: rec.suggestedValue,
        confidence: rec.score,
        evidence: {
          executions: rec.executions,
          successRate: rec.successRate,
        },
        createdAt: new Date().toISOString(),
      })
    }

    return { templateId, proposals }
  }

  private findAlternativeValue(
    parameters: Array<{ name: string; values: Array<{ value: string; executions: number }> }>,
    paramName: string,
    suggestedValue: string,
  ): string | undefined {
    const param = parameters.find((p) => p.name === paramName)
    if (!param) return undefined
    const sorted = [...param.values].sort((a, b) => b.executions - a.executions)
    const alt = sorted.find((v) => v.value !== suggestedValue)
    return alt?.value
  }
}
