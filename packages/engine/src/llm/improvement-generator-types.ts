import type { Goal, GoalPlan, Milestone } from "@arelyos/persistence";

export interface GeneratedImprovement {
  recommendationLabel: string
  dimension: string
  goal: Goal
  plan: GoalPlan
  milestones: Milestone[]
}

export interface ImprovementGenerationResult {
  improvements: GeneratedImprovement[]
  totalCreated: number
  summary: string
}
