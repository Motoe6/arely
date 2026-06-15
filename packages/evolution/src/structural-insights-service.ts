import type { TemplateRegistryLike } from "./types.js"
import { getFeedbackByTemplate } from "@arelyos/persistence"
import { StructuralAnalyzer } from "./structural-analyzer.js"
import type { StructuralPattern, StructuralInsight, StructuralInsightsResult } from "./structural-pattern-types.js"

type DbClient = any

const PATTERN_LABELS: Record<StructuralPattern, string> = {
  single_step: "Single step",
  multi_step_chain: "Multi-step chain",
  http_llm_chain: "HTTP → LLM chain",
  webhook_trigger: "Webhook trigger",
  schedule_trigger: "Schedule trigger",
  has_onfailure_handling: "Has error handling",
  has_retry_config: "Has retry config",
  dynamic_name: "Dynamic name",
  parameterized: "Parameterized",
}

const ALL_PATTERNS: StructuralPattern[] = Object.keys(PATTERN_LABELS) as StructuralPattern[]

export class StructuralInsightsService {
  constructor(
    private registry: TemplateRegistryLike,
    private options?: { db?: DbClient },
  ) {}

  getInsights(): StructuralInsightsResult {
    const db = this.options?.db
    const analyzer = new StructuralAnalyzer()
    const templates = this.registry.list()
    const totalTemplates = templates.length

    const categoryMap = new Map<string, typeof templates>()
    for (const t of templates) {
      const cat = t.category ?? "uncategorized"
      if (!categoryMap.has(cat)) categoryMap.set(cat, [])
      categoryMap.get(cat)!.push(t)
    }

    const overall = this.computeInsights(templates, totalTemplates, db, analyzer)
    const byCategory: Record<string, StructuralInsight[]> = {}

    for (const [cat, tpls] of categoryMap) {
      byCategory[cat] = this.computeInsights(tpls, totalTemplates, db, analyzer)
    }

    return { overall, byCategory }
  }

  private computeInsights(
    templates: { id: string }[],
    totalTemplates: number,
    db: DbClient | undefined,
    analyzer: StructuralAnalyzer,
  ): StructuralInsight[] {
    const patternTemplateMap = new Map<StructuralPattern, string[]>()

    for (const pattern of ALL_PATTERNS) {
      patternTemplateMap.set(pattern, [])
    }

    for (const meta of templates) {
      const template = this.registry.get(meta.id)
      if (!template) continue
      const feature = analyzer.analyze(template)
      const matches = analyzer.detectPatterns(template, feature)
      for (const m of matches) {
        const list = patternTemplateMap.get(m.pattern)!
        list.push(meta.id)
      }
    }

    const insights: StructuralInsight[] = []

    for (const pattern of ALL_PATTERNS) {
      const matchedIds = patternTemplateMap.get(pattern) ?? []
      const frequency = matchedIds.length
      if (frequency === 0) continue

      const frequencyPct = Math.round((frequency / totalTemplates) * 1000) / 10

      let totalExecutions = 0
      let totalSuccesses = 0
      let totalConfidenceNumerator = 0

      for (const tid of matchedIds) {
        const feedback = getFeedbackByTemplate(tid, db)
        for (const fb of feedback) {
          totalExecutions++
          if (fb.success) totalSuccesses++
        }
        const confidence = Math.min(1, feedback.length / 20)
        totalConfidenceNumerator += confidence * feedback.length
      }

      const sampleExecutions = totalExecutions
      const avgSuccessRate = totalExecutions > 0 ? totalSuccesses / totalExecutions : 0
      const avgConfidence = totalExecutions > 0 ? totalConfidenceNumerator / totalExecutions : 0

      insights.push({
        pattern,
        label: PATTERN_LABELS[pattern],
        frequency,
        totalTemplates,
        frequencyPct,
        sampleExecutions,
        avgSuccessRate: Math.round(avgSuccessRate * 1000) / 1000,
        avgConfidence: Math.round(avgConfidence * 1000) / 1000,
      })
    }

    insights.sort((a, b) => b.frequency - a.frequency)
    return insights
  }
}
