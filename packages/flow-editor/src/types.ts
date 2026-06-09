import type { Node, Edge } from "reactflow"

export interface FlowNode {
  type: string
  label: string
  category: "trigger" | "action" | "logic" | "ai" | "code"
}

export interface WorkflowSummary {
  id: string
  description?: string
  stepCount: number
}

export interface IntentTrigger {
  type: "manual" | "webhook" | "interval" | "event"
  config?: Record<string, unknown>
}

export interface IntentStep {
  id: string
  type: string
  label?: string
  input?: Record<string, unknown>
  next?: string | string[]
  onFailure?: { retry?: { maxAttempts: number; delayMs: number }; fallback?: string }
}

export interface Workflow {
  id: string
  name?: string
  description?: string
  version: string
  trigger?: IntentTrigger
  steps: IntentStep[]
}

export interface CompileDiagnostic {
  kind: "warning" | "error"
  message: string
}

export interface CompileResult {
  success: boolean
  workflow?: Workflow
  diagnostics?: CompileDiagnostic[]
}

export interface StepExecutionResult {
  stepId: string
  status: "completed" | "failed"
  output?: string
  error?: string
}

export interface ExecuteResult {
  success: boolean
  runId: string
  steps: StepExecutionResult[]
  outputs?: Record<string, unknown>
  error?: string
}

export interface WorkflowRun {
  id: string
  workflowId: string
  workflowVersion: number
  status: "running" | "completed" | "failed"
  triggerInput: Record<string, unknown> | null
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  error: string | null
}

export interface WorkflowStepRun {
  id: string
  runId: string
  stepId: string
  stepType: string
  status: "running" | "completed" | "failed"
  input: Record<string, unknown> | null
  output: string | null
  error: string | null
  startedAt: string
  completedAt: string | null
  durationMs: number | null
}

export interface RunWithSteps {
  run: WorkflowRun
  steps: WorkflowStepRun[]
}

export interface MetricsSummary {
  totalRuns: number
  completedRuns: number
  failedRuns: number
  runningRuns: number
  successRate: number
  failureRate: number
  avgDurationMs: number
  totalDurationMs: number | null
  firstRun: string | null
  lastRun: string | null
  totalWorkflows: number
  runsPerDay: number
  topNodes: { stepType: string; count: number; avgDurationMs: number; failCount: number }[]
  slowestNodes: { stepType: string; avgDurationMs: number; count: number }[]
}

export interface FlowNodeData {
  step: IntentStep
  label: string
  category: string
  status?: "idle" | "completed" | "failed"
}

export type FlowNodeType = Node<FlowNodeData>
export type FlowEdgeType = Edge
