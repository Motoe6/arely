import * as fs from "node:fs"
import * as path from "node:path"
import type { LearnedWeights, WeightCategoryMap, RolePerformanceRecord } from "./learning-types.js"
import { DEFAULT_WEIGHT_MAP } from "./learning-types.js"
import type { TaskCategory, SwarmRole } from "./role-types.js"
import { ROLE_CATEGORY_MAP } from "./role-types.js"
import { loadPerformanceHistory } from "./role-performance-store.js"
import { optimizeWeights, mergeWeights } from "./weight-optimizer.js"

const PERSISTED_WEIGHTS_PATH = "benchmark-reports/learned-weights.json"

export function loadLearnedWeights(): WeightCategoryMap {
  try {
    if (fs.existsSync(PERSISTED_WEIGHTS_PATH)) {
      const raw = fs.readFileSync(PERSISTED_WEIGHTS_PATH, "utf-8")
      return JSON.parse(raw) as WeightCategoryMap
    }
  } catch {
    // No persisted weights yet
  }
  return { ...DEFAULT_WEIGHT_MAP }
}

export function saveLearnedWeights(weights: WeightCategoryMap): void {
  try {
    fs.mkdirSync(path.dirname(PERSISTED_WEIGHTS_PATH), { recursive: true })
    fs.writeFileSync(PERSISTED_WEIGHTS_PATH, JSON.stringify(weights, null, 2), "utf-8")
  } catch {
    // Best effort
  }
}

export function getWeightsForCategory(
  weights: WeightCategoryMap,
  category: TaskCategory,
): LearnedWeights {
  return weights[category] ?? DEFAULT_WEIGHT_MAP[category]
}

export function getWeightsForRole(
  weights: WeightCategoryMap,
  role: SwarmRole,
): LearnedWeights {
  const category = ROLE_CATEGORY_MAP[role]
  return getWeightsForCategory(weights, category)
}

/**
 * Full learning cycle:
 * 1. Load performance history
 * 2. Optimize weights based on empirical outcomes
 * 3. Merge with current weights (blend)
 * 4. Persist updated weights
 * 5. Return the learned weights
 */
export function runLearningCycle(blendRate: number = 0.3): WeightCategoryMap {
  const records = loadPerformanceHistory()

  if (records.length < 3) {
    // Not enough data to learn — return defaults
    return { ...DEFAULT_WEIGHT_MAP }
  }

  const currentWeights = loadLearnedWeights()
  const optimizedWeights = optimizeWeights(records)
  const blended = mergeWeights(currentWeights, optimizedWeights, blendRate)
  saveLearnedWeights(blended)

  return blended
}

/**
 * Predict the effective score for a given category using learned weights.
 */
export function predictScore(
  weights: WeightCategoryMap,
  category: TaskCategory,
  inputs: {
    historicalScore: number
    utility: number
    availability: number
    costEfficiency: number
    latencyScore: number
  },
): number {
  const w = getWeightsForCategory(weights, category)

  const raw =
    inputs.historicalScore * w.historicalScore +
    inputs.utility * w.utility +
    inputs.availability * w.availability +
    inputs.costEfficiency * w.costEfficiency +
    inputs.latencyScore * w.latencyScore

  return Math.max(0, Math.min(1, raw))
}
