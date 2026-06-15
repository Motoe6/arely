import type { ExecutionPrediction } from "./prediction-types.js";

export interface GoalForecast {
  goalId: string
  predictedSuccessPct: number
  currentProgressPct: number
  predictedProgressGainPct: number
  expectedUtility: number
  confidence: number
  rationale: string
}

export interface GoalForecastContext {
  goalId: string
  planId?: string
  milestoneId?: string
  prediction: ExecutionPrediction
}
