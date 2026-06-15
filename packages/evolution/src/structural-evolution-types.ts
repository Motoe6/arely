import type { StructuralPattern } from "./structural-pattern-types.js"

export type StructuralEvolutionKind =
  | "add_retry"
  | "add_error_handling"
  | "split_into_chain"
  | "parameterize_value"

export interface StructuralEvolutionProposal {
  id: string
  templateId: string
  kind: StructuralEvolutionKind
  title: string
  description: string
  confidence: number
  evidence: {
    pattern: StructuralPattern
    avgSuccessRate: number
    avgConfidence: number
    sampleExecutions: number
  }
  rationale: string
}
