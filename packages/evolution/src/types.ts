export type TemplateParamType = "string" | "number" | "boolean" | "json"
export type TemplateSource = "builtin" | "user" | "package"

export interface TemplateParameter {
  name: string
  label: string
  type: TemplateParamType
  required?: boolean
  default?: unknown
  description?: string
}

export interface TemplateMetadata {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  templateVersion: string
  author: string
  parameters: TemplateParameter[]
  requires: string[]
  source: TemplateSource
}

export interface Template {
  metadata: TemplateMetadata
  workflowDsl: string
  workflowObj: Record<string, unknown>
}

export interface TemplateRegistryLike {
  get(id: string): Template | undefined
  list(category?: string): TemplateMetadata[]
  unregisterTemplate(id: string): boolean
  registerInline(template: Template): void
}

export interface ParameterRecommendation {
  parameter: string
  suggestedValue: string
  score: number
  executions: number
  successRate: number
}

export interface ParameterRecommendationsResult {
  templateId: string
  recommendations: ParameterRecommendation[]
}

export interface ParameterRecommenderLike {
  getRecommendations(templateId: string, db?: any): ParameterRecommendationsResult
}

export interface ParameterValueInsight {
  value: string
  executions: number
}

export interface ParameterInsight {
  name: string
  values: ParameterValueInsight[]
}

export interface ParameterInsightsResult {
  templateId: string
  parameters: ParameterInsight[]
}

export interface ParameterEffectivenessLike {
  getInsights(templateId: string, db?: any): ParameterInsightsResult
}
