import type { TemplateRegistry } from "./template-registry.js"
import type { TemplateMetadata } from "./template-types.js"
import type { TemplateMetricsService } from "./template-metrics.js"

export interface Recommendation {
  templateId: string
  score: number
  reason: string
  semanticScore?: number
  successRate?: number
  weightedSuccess?: number
}

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "for", "of", "in",
  "on", "at", "by", "with", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "out", "off", "over",
  "under", "again", "further", "then", "once", "here", "there", "when",
  "where", "why", "how", "all", "each", "every", "both", "few", "more",
  "most", "other", "some", "such", "no", "nor", "not", "only", "own",
  "same", "so", "than", "too", "very", "just", "because", "and", "but",
  "or", "if", "while", "get", "got", "use", "used", "using", "want",
  "needs", "need", "like", "make", "made", "take", "know", "see",
  "time", "way", "things", "thing",
])

const SCORE_TAG = 5
const SCORE_CATEGORY = 4
const SCORE_NAME = 3
const SCORE_DESCRIPTION = 2
const MAX_PER_TOKEN = SCORE_TAG + SCORE_CATEGORY + SCORE_NAME + SCORE_DESCRIPTION
const MIN_SCORE = 0.10

const SEMANTIC_WEIGHT = 0.7
const SUCCESS_RATE_WEIGHT = 0.3

export class TemplateRecommender {
  constructor(
    private registry: TemplateRegistry,
    private metricsService?: TemplateMetricsService,
  ) {}

  recommend(query: string, topN = 5): Recommendation[] {
    const tokens = this.tokenize(query)
    if (tokens.length === 0) return []

    const templates = this.registry.list()
    const scored: Array<{ id: string; raw: number; matchedTokens: number; reasons: Set<string> }> = []

    for (const t of templates) {
      const result = this.scoreTemplate(t, tokens)
      if (result.raw > 0) {
        scored.push(result)
      }
    }

    const rawMax = tokens.length * MAX_PER_TOKEN

    const metricsMap = this.metricsService
      ? new Map(this.metricsService.getAllRanked().map((m) => [m.templateId, m]))
      : null

    let results = scored
      .map((s) => {
        const effectiveMax = s.matchedTokens * MAX_PER_TOKEN
        const semanticScore = effectiveMax > 0 ? Math.min(1, s.raw / effectiveMax) : 0
        let finalScore = semanticScore
        let successRate: number | undefined
        let weightedSuccess: number | undefined

        if (metricsMap) {
          const metric = metricsMap.get(s.id)
          if (metric && metric.executions > 0) {
            successRate = metric.successRate
            weightedSuccess = metric.weightedSuccess
            finalScore = semanticScore * SEMANTIC_WEIGHT + weightedSuccess * SUCCESS_RATE_WEIGHT
          }
        }

        return {
          templateId: s.id,
          score: finalScore,
          reason: this.formatReason(s.reasons),
          semanticScore,
          successRate,
          weightedSuccess,
        }
      })
      .filter((r) => r.score >= MIN_SCORE)

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.templateId.localeCompare(b.templateId)
    })

    return results.slice(0, Math.max(1, Math.min(20, topN)))
  }

  private tokenize(query: string): string[] {
    return query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0 && !STOP_WORDS.has(t))
  }

  private scoreTemplate(
    metadata: TemplateMetadata,
    tokens: string[],
  ): { id: string; raw: number; matchedTokens: number; reasons: Set<string> } {
    let raw = 0
    const usedTokenCount = new Set<number>()
    const nameLower = metadata.name.toLowerCase()
    const descLower = metadata.description.toLowerCase()
    const catLower = metadata.category.toLowerCase()
    const tagsLower = metadata.tags.map((t) => t.toLowerCase())

    for (let ti = 0; ti < tokens.length; ti++) {
      const token = tokens[ti]
      let tokenMatched = false
      let matchedTag = false
      let matchedCategory = false
      let matchedName = false
      let matchedDescription = false

      for (const tag of tagsLower) {
        if (tag.includes(token) || token.includes(tag)) {
          if (!matchedTag) {
            raw += SCORE_TAG
            matchedTag = true
            tokenMatched = true
          }
          break
        }
      }

      if (catLower.includes(token) || token.includes(catLower)) {
        raw += SCORE_CATEGORY
        matchedCategory = true
        tokenMatched = true
      }

      if (nameLower.includes(token)) {
        raw += SCORE_NAME
        matchedName = true
        tokenMatched = true
      }

      if (descLower.includes(token)) {
        raw += SCORE_DESCRIPTION
        matchedDescription = true
        tokenMatched = true
      }

      if (tokenMatched) {
        usedTokenCount.add(ti)
      }
    }

    const reasons = new Set<string>()
    if (usedTokenCount.size > 0) {
      const matched = tokens.filter((_, i) => usedTokenCount.has(i))
      for (const tok of matched) {
        reasons.add(tok)
      }
    }

    return {
      id: metadata.id,
      raw,
      matchedTokens: usedTokenCount.size,
      reasons,
    }
  }

  private formatReason(reasons: Set<string>): string {
    const list = Array.from(reasons)
    if (list.length === 0) return ""
    if (list.length <= 3) return `matched ${list.join(", ")}`
    return `matched ${list.slice(0, 3).join(", ")} and ${list.length - 3} more`
  }
}
