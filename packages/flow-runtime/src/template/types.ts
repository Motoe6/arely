export type TemplateSource = "trigger" | "steps" | "secrets"

export interface TemplateExpression {
  raw: string
  source: TemplateSource
  path: string[]
}

export interface ResolvedTemplate {
  raw: string
  resolved: string
  expressions: TemplateExpression[]
}

export interface ExecutionContext {
  trigger: unknown
  steps: Map<string, unknown>
  secrets: Map<string, string>
}
