import type { LearnedWeights, WeightCategoryMap, RolePerformanceRecord } from "./learning-types.js"
import { DEFAULT_WEIGHTS, DEFAULT_WEIGHT_MAP } from "./learning-types.js"
import type { TaskCategory } from "./role-types.js"
import { TASK_CATEGORIES } from "./role-types.js"
import { getStatsByCategory } from "./role-performance-store.js"

/**
 * Compute the correlation between a weight factor and actual outcome success.
 * Returns a value 0..1 indicating how predictive that factor is.
 */
function computePredictiveness(
  records: RolePerformanceRecord[],
  extractor: (r: RolePerformanceRecord) => number,
): number {
  if (records.length < 3) return 0.5

  const successes = records.filter((r) => r.success)
  const failures = records.filter((r) => !r.success)

  if (successes.length === 0 || failures.length === 0) return 0.5

  const avgSuccess = successes.reduce((s, r) => s + extractor(r), 0) / successes.length
  const avgFailure = failures.reduce((s, r) => s + extractor(r), 0) / failures.length
  const diff = Math.abs(avgSuccess - avgFailure)
  const maxDiff = Math.max(
    Math.abs(avgSuccess),
    Math.abs(avgFailure),
    1,
  )

  return Math.min(1, diff / maxDiff)
}

function predictivenessByCategory(
  records: RolePerformanceRecord[],
  category: TaskCategory,
): {
  utility: number
  latencyScore: number
  costEfficiency: number
} {
  const catRecords = records.filter((r) => r.category === category)
  const maxLatency = Math.max(...catRecords.map((r) => r.latencyMs), 1)

  return {
    utility: computePredictiveness(catRecords, (r) => r.utility),
    latencyScore: computePredictiveness(catRecords, (r) => 1 - r.latencyMs / maxLatency),
    costEfficiency: computePredictiveness(catRecords, (r) => r.utility / Math.max(r.latencyMs, 1)),
  }
}

function normalizeWeights(input: Record<string, number>): LearnedWeights {
  const keys: (keyof LearnedWeights)[] = ["historicalScore", "utility", "availability", "costEfficiency", "latencyScore"]
  const total = keys.reduce((s, k) => s + Math.abs(input[k] ?? DEFAULT_WEIGHTS[k]), 0)

  if (total === 0) return { ...DEFAULT_WEIGHTS }

  const result: Record<string, number> = {}
  for (const k of keys) {
    result[k] = (input[k] ?? DEFAULT_WEIGHTS[k]) / total
  }

  return result as unknown as LearnedWeights
}

export function optimizeWeights(records: RolePerformanceRecord[]): WeightCategoryMap {
  const result: Partial<WeightCategoryMap> = {}

  for (const category of TASK_CATEGORIES) {
    const predictiveness = predictivenessByCategory(records, category)
    const catStats = getStatsByCategory(records, category)
    const totalRuns = catStats.reduce((s, p) => s + p.count, 0)

    // Boost utility weight if it's highly predictive
    const utilityWeight = Math.max(0.10, DEFAULT_WEIGHTS.utility + predictiveness.utility * 0.3)

    // Boost latency weight if it's predictive
    const latencyWeight = Math.max(0.03, DEFAULT_WEIGHTS.latencyScore + predictiveness.latencyScore * 0.2)

    // Lower historical score weight when we have good empirical data
    const dataConfidence = Math.min(1, totalRuns / 20)
    const historicalWeight = Math.max(0.10, DEFAULT_WEIGHTS.historicalScore * (1 - dataConfidence * 0.5))

    // Availability and cost efficiency stay stable
    const availabilityWeight = DEFAULT_WEIGHTS.availability
    const costEfficiencyWeight = DEFAULT_WEIGHTS.costEfficiency

    result[category] = normalizeWeights({
      historicalScore: historicalWeight,
      utility: utilityWeight,
      availability: availabilityWeight,
      costEfficiency: costEfficiencyWeight,
      latencyScore: latencyWeight,
    })
  }

  // Fill any missing categories with defaults
  for (const cat of TASK_CATEGORIES) {
    if (!result[cat]) {
      result[cat] = { ...DEFAULT_WEIGHTS }
    }
  }

  return result as unknown as WeightCategoryMap
}

export function mergeWeights(
  current: WeightCategoryMap,
  optimized: WeightCategoryMap,
  blendRate: number = 0.3,
): WeightCategoryMap {
  const result: Partial<WeightCategoryMap> = {}

  for (const category of TASK_CATEGORIES) {
    const cur = current[category] ?? DEFAULT_WEIGHTS
    const opt = optimized[category] ?? DEFAULT_WEIGHTS
    const keys: (keyof LearnedWeights)[] = ["historicalScore", "utility", "availability", "costEfficiency", "latencyScore"]

    const blended: Record<string, number> = {}
    for (const k of keys) {
      blended[k] = cur[k] * (1 - blendRate) + opt[k] * blendRate
    }

    result[category] = normalizeWeights(blended)
  }

  return result as unknown as WeightCategoryMap
}
