import type { FlowNode, WorkflowSummary, CompileResult, ExecuteResult, Workflow, RunWithSteps, MetricsSummary } from "./types.js"

const BASE = ""

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body as T
}

export function listNodes(): Promise<FlowNode[]> {
  return api<FlowNode[]>("/api/flow/nodes")
}

export function listWorkflows(): Promise<WorkflowSummary[]> {
  return api<WorkflowSummary[]>("/api/flow/workflows")
}

export function compilePrompt(prompt: string): Promise<CompileResult> {
  return api<CompileResult>("/api/flow/compile", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  })
}

export function executeWorkflow(
  workflowId: string,
  triggerInput?: Record<string, unknown>,
): Promise<ExecuteResult> {
  return api<ExecuteResult>("/api/flow/execute", {
    method: "POST",
    body: JSON.stringify({ workflowId, triggerInput: triggerInput ?? {} }),
  })
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  try {
    return await api<Workflow>(`/api/flow/workflows/${id}`)
  } catch {
    return null
  }
}

export async function listRuns(workflowId?: string): Promise<RunWithSteps[]> {
  const params = workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : ""
  return api<RunWithSteps[]>(`/api/flow/runs${params}`)
}

export async function getRun(id: string): Promise<RunWithSteps | null> {
  try {
    return await api<RunWithSteps>(`/api/flow/runs/${id}`)
  } catch {
    return null
  }
}

export async function getMetricsSummary(): Promise<MetricsSummary> {
  return api<MetricsSummary>("/api/flow/metrics/summary")
}
