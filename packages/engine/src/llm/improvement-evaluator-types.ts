import type { Finding, AssessmentDimension } from "./self-assessment-types.js";

export interface ImprovementDelta {
  dimension: AssessmentDimension
  label: string
  beforeMetric: number
  afterMetric: number
  delta: number
  improved: boolean
}

export interface ImprovementEvaluation {
  deltas: ImprovementDelta[]
  resolvedWeaknesses: Finding[]
  newWeaknesses: Finding[]
  persistentWeaknesses: Finding[]
  totalImproved: number
  totalDeclined: number
  summary: string
}
