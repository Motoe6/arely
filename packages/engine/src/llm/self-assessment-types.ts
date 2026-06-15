export type AssessmentDimension = "strategy" | "model" | "prediction" | "reasoning" | "goal_progress"

export interface Finding {
  type: "strength" | "weakness"
  dimension: AssessmentDimension
  label: string
  metric: number
  threshold: number
  details: string
}

export interface Recommendation {
  dimension: AssessmentDimension
  label: string
  description: string
  expectedImpact: string
}

export interface SelfAssessment {
  strengths: Finding[]
  weaknesses: Finding[]
  recommendations: Recommendation[]
  summary: string
}
