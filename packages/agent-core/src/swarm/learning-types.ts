import type { SwarmRole, TaskCategory } from "./role-types.js"

export interface RolePerformanceRecord {
  timestamp: string
  sessionId: string
  category: TaskCategory
  role: SwarmRole
  provider: string
  model: string
  success: boolean
  latencyMs: number
  utility: number
  score: number
}

export interface LearnedWeights {
  historicalScore: number
  utility: number
  availability: number
  costEfficiency: number
  latencyScore: number
}

export const DEFAULT_WEIGHTS: LearnedWeights = {
  historicalScore: 0.50,
  utility: 0.20,
  availability: 0.15,
  costEfficiency: 0.10,
  latencyScore: 0.05,
}

export type WeightCategoryMap = Record<TaskCategory, LearnedWeights>

export const DEFAULT_WEIGHT_MAP: WeightCategoryMap = {
  coding: { ...DEFAULT_WEIGHTS },
  research: { ...DEFAULT_WEIGHTS },
  planning: { ...DEFAULT_WEIGHTS },
  "tool-use": { ...DEFAULT_WEIGHTS },
  "multi-step-research": { ...DEFAULT_WEIGHTS },
  "implementation-design": { ...DEFAULT_WEIGHTS },
}

export interface CategoryStats {
  total: number
  successes: number
  avgLatencyMs: number
  avgUtility: number
}

export interface ProviderRoleStats {
  provider: string
  model: string
  successRate: number
  avgUtility: number
  avgLatencyMs: number
  count: number
}
