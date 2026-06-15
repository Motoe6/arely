export type StructuralPattern =
  | "single_step"
  | "multi_step_chain"
  | "http_llm_chain"
  | "webhook_trigger"
  | "schedule_trigger"
  | "has_onfailure_handling"
  | "has_retry_config"
  | "dynamic_name"
  | "parameterized"

export interface StructuralFeature {
  stepCount: number
  stepTypes: string[]
  hasChaining: boolean
  maxChainDepth: number
  hasConditionalBranches: boolean
  hasFanOut: boolean
  hasErrorHandling: boolean
  hasRetryConfig: boolean
  triggerType: string
  usesDynamicName: boolean
  parameterCount: number
  isParameterized: boolean
}

export interface StructuralPatternMatch {
  pattern: StructuralPattern
  templateId: string
  label: string
}

export interface StructuralInsight {
  pattern: StructuralPattern
  label: string
  frequency: number
  totalTemplates: number
  frequencyPct: number
  sampleExecutions: number
  avgSuccessRate: number
  avgConfidence: number
}

export interface StructuralInsightsResult {
  overall: StructuralInsight[]
  byCategory: Record<string, StructuralInsight[]>
}
