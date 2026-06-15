import { ulid } from "ulid"
import type { TemplateRegistryLike, Template } from "./types.js"
import { StructuralAnalyzer } from "./structural-analyzer.js"
import { StructuralInsightsService } from "./structural-insights-service.js"
import type { StructuralEvolutionProposal, StructuralEvolutionKind } from "./structural-evolution-types.js"
import type { StructuralPattern, StructuralInsight } from "./structural-pattern-types.js"

type DbClient = any

const MIN_SAMPLE = 20
const MIN_SUCCESS_RETRY = 0.80
const MIN_SUCCESS_EH = 0.80
const MIN_SUCCESS_PARAM = 0.75
const MIN_DELTA = 0.15

interface RuleResult {
  kind: StructuralEvolutionKind
  title: string
  description: string
  pattern: StructuralPattern
  successRate: number
  confidence: number
  sampleExecutions: number
  rationale: string
}

export class StructuralEvolutionProposalService {
  private analyzer = new StructuralAnalyzer()

  constructor(
    private registry: TemplateRegistryLike,
    private options?: { db?: DbClient },
  ) {}

  getProposals(templateId?: string): StructuralEvolutionProposal[] {
    const insightsSvc = new StructuralInsightsService(this.registry, this.options)
    const insights = insightsSvc.getInsights()

    const templates: Template[] = []
    if (templateId) {
      const t = this.registry.get(templateId)
      if (t) templates.push(t)
    } else {
      for (const meta of this.registry.list()) {
        const t = this.registry.get(meta.id)
        if (t) templates.push(t)
      }
    }

    const proposals: StructuralEvolutionProposal[] = []

    for (const t of templates) {
      const feature = this.analyzer.analyze(t)
      const results: RuleResult[] = []

      const retryProposal = this.evaluateAddRetry(feature, insights, t)
      if (retryProposal) results.push(retryProposal)

      const ehProposal = this.evaluateAddErrorHandling(feature, insights, t)
      if (ehProposal) results.push(ehProposal)

      const paramProposal = this.evaluateParameterize(feature, insights, t)
      if (paramProposal) results.push(paramProposal)

      const chainProposal = this.evaluateSplitIntoChain(feature, insights, t)
      if (chainProposal) results.push(chainProposal)

      for (const r of results) {
        proposals.push({
          id: ulid(),
          templateId: t.metadata.id,
          kind: r.kind,
          title: r.title,
          description: r.description,
          confidence: Math.round(r.confidence * 1000) / 1000,
          evidence: {
            pattern: r.pattern,
            avgSuccessRate: Math.round(r.successRate * 1000) / 1000,
            avgConfidence: Math.round(r.confidence * 1000) / 1000,
            sampleExecutions: r.sampleExecutions,
          },
          rationale: r.rationale,
        })
      }
    }

    proposals.sort((a, b) => b.confidence - a.confidence)
    return proposals
  }

  private evaluateAddRetry(
    feature: ReturnType<StructuralAnalyzer["analyze"]>,
    insights: ReturnType<StructuralInsightsService["getInsights"]>,
    _template: Template,
  ): RuleResult | null {
    if (feature.hasRetryConfig) return null
    const insight = this.findInsight(insights, "has_retry_config")
    if (!insight || insight.avgSuccessRate < MIN_SUCCESS_RETRY || insight.sampleExecutions < MIN_SAMPLE) return null
    const confidence = insight.avgSuccessRate * insight.avgConfidence
    return {
      kind: "add_retry",
      title: "Add retry configuration",
      description: "This template lacks retry handling. Templates with retry show higher success rates.",
      pattern: "has_retry_config",
      successRate: insight.avgSuccessRate,
      confidence,
      sampleExecutions: insight.sampleExecutions,
      rationale: `Templates with retry handling show ${(insight.avgSuccessRate * 100).toFixed(0)}% success across ${insight.sampleExecutions} executions (confidence: ${(confidence * 100).toFixed(0)}%).`,
    }
  }

  private evaluateAddErrorHandling(
    feature: ReturnType<StructuralAnalyzer["analyze"]>,
    insights: ReturnType<StructuralInsightsService["getInsights"]>,
    _template: Template,
  ): RuleResult | null {
    if (feature.hasErrorHandling) return null
    const insight = this.findInsight(insights, "has_onfailure_handling")
    if (!insight || insight.avgSuccessRate < MIN_SUCCESS_EH || insight.sampleExecutions < MIN_SAMPLE) return null
    const confidence = insight.avgSuccessRate * insight.avgConfidence
    return {
      kind: "add_error_handling",
      title: "Add error handling",
      description: "This template lacks error handling. Templates with onFailure handlers show higher success rates.",
      pattern: "has_onfailure_handling",
      successRate: insight.avgSuccessRate,
      confidence,
      sampleExecutions: insight.sampleExecutions,
      rationale: `Templates with error handling show ${(insight.avgSuccessRate * 100).toFixed(0)}% success across ${insight.sampleExecutions} executions (confidence: ${(confidence * 100).toFixed(0)}%).`,
    }
  }

  private evaluateParameterize(
    feature: ReturnType<StructuralAnalyzer["analyze"]>,
    insights: ReturnType<StructuralInsightsService["getInsights"]>,
    _template: Template,
  ): RuleResult | null {
    if (feature.isParameterized) return null
    const insight = this.findInsight(insights, "parameterized")
    if (!insight || insight.avgSuccessRate < MIN_SUCCESS_PARAM || insight.sampleExecutions < MIN_SAMPLE) return null
    const confidence = insight.avgSuccessRate * insight.avgConfidence
    return {
      kind: "parameterize_value",
      title: "Parameterize template values",
      description: "This template uses hardcoded values. Parameterized templates show higher success rates.",
      pattern: "parameterized",
      successRate: insight.avgSuccessRate,
      confidence,
      sampleExecutions: insight.sampleExecutions,
      rationale: `Parameterized templates show ${(insight.avgSuccessRate * 100).toFixed(0)}% success across ${insight.sampleExecutions} executions (confidence: ${(confidence * 100).toFixed(0)}%).`,
    }
  }

  private evaluateSplitIntoChain(
    feature: ReturnType<StructuralAnalyzer["analyze"]>,
    insights: ReturnType<StructuralInsightsService["getInsights"]>,
    _template: Template,
  ): RuleResult | null {
    if (feature.stepCount !== 1) return null
    const chainInsight = this.findInsight(insights, "multi_step_chain")
    const singleInsight = this.findInsight(insights, "single_step")
    if (!chainInsight || !singleInsight) return null
    if (chainInsight.sampleExecutions < MIN_SAMPLE || singleInsight.sampleExecutions < MIN_SAMPLE) return null
    const delta = chainInsight.avgSuccessRate - singleInsight.avgSuccessRate
    if (delta < MIN_DELTA) return null
    const confidence = chainInsight.avgSuccessRate * chainInsight.avgConfidence
    return {
      kind: "split_into_chain",
      title: "Split workflow into chained steps",
      description: "Single-step templates underperform chained workflows. Consider splitting into a multi-step chain.",
      pattern: "multi_step_chain",
      successRate: chainInsight.avgSuccessRate,
      confidence,
      sampleExecutions: chainInsight.sampleExecutions,
      rationale: `Chained workflows show ${(chainInsight.avgSuccessRate * 100).toFixed(0)}% success vs ${(singleInsight.avgSuccessRate * 100).toFixed(0)}% for single-step (delta: ${(delta * 100).toFixed(0)}%, confidence: ${(confidence * 100).toFixed(0)}%).`,
    }
  }

  private findInsight(
    insights: ReturnType<StructuralInsightsService["getInsights"]>,
    pattern: StructuralPattern,
  ): StructuralInsight | undefined {
    return insights.overall.find((i) => i.pattern === pattern)
  }
}
