export type TemplateParamType = "string" | "number" | "boolean" | "json"

export interface TemplateParameter {
  name: string
  label: string
  type: TemplateParamType
  required?: boolean
  default?: unknown
  description?: string
}
