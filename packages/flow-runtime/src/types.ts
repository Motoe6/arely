export interface RetryConfig {
  maxAttempts: number
  delayMs: number
}

export interface FailureStrategy {
  retry?: RetryConfig
  fallback?: string
}

export interface WorkflowStep {
  id: string
  type: string
  input?: Record<string, unknown>
  next?: string | string[]
  onFailure?: FailureStrategy
}

export interface TriggerDef {
  type: "manual" | "webhook" | "interval" | "event"
  config?: Record<string, unknown>
}

export interface Workflow {
  id: string
  name?: string
  description?: string
  version: string
  trigger?: TriggerDef
  steps: WorkflowStep[]
}

export interface DAGEdge {
  from: string
  to: string
  kind: "next" | "fallback"
}

export interface DAGValidationResult {
  valid: boolean
  cycles: string[][]
  missingReferences: { from: string; ref: string; kind: string }[]
  selfReferences: string[]
  unreachableSteps: string[]
}

export interface CompileResult {
  pipeline: CompiledPipeline
  errors: CompileError[]
  warnings: CompileWarning[]
}

export interface CompiledPipeline {
  name: string
  steps: CompiledStep[]
}

export interface CompiledStep {
  id: string
  type: string
  input: Record<string, unknown>
  dependsOn: string[]
  timeoutMs: number | null
  retries: number | null
  retryDelayMs: number | null
}

export interface CompileError {
  stepId: string
  message: string
}

export interface CompileWarning {
  stepId: string
  message: string
}
