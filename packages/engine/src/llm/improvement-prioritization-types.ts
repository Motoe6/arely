import type { GeneratedImprovement } from "./improvement-generator-types.js";

export interface PrioritizedImprovement {
  improvement: GeneratedImprovement
  rank: number
  expectedUtility: number
  predictedProgressGainPct: number
  predictedSuccessPct: number
  confidence: number
}

export interface PrioritizationResult {
  prioritized: PrioritizedImprovement[]
  totalScored: number
  summary: string
}
