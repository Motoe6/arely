export type SessionState = "idle" | "running" | "awaiting_permission" | "completed" | "error" | "interrupted"
export type ToolStatus = "pending" | "running" | "completed" | "error" | "failed" | "cancelled" | "timed_out"
export type PermissionMode = "ask" | "allow" | "deny"
export type ApprovalScope = "once" | "session" | "forever"

export interface Session {
  id: string
  state: SessionState
  query: string
  model: string
  toolMode: "native" | "text"
  createdAt: string
  updatedAt: string
  completedAt: string | null
  error: string | null
}

export interface Message {
  id: string
  sessionId: string
  role: "user" | "assistant" | "system"
  content: string
  sequence: number
  createdAt: string
}

export interface ToolCallRecord {
  id: string
  sessionId: string
  toolName: string
  args: unknown
  status: ToolStatus
  result: string | null
  error: string | null
  startTime: string | null
  endTime: string | null
  durationMs: number | null
  provider: string | null
  permissionMode: PermissionMode
  permissionGranted: number | null
  createdAt: string
}

export interface PermissionApproval {
  id: string
  sessionId: string
  toolName: string
  args: unknown
  mode: PermissionMode
  granted: boolean
  respondedAt: string
  responseTimeMs: number | null
}

export interface ApprovalCacheEntry {
  id: string
  sessionId: string | null
  toolName: string
  argsPattern: string
  scope: ApprovalScope
  granted: boolean
  createdAt: string
  expiresAt: string | null
}

export type PlanStatus = "pending" | "executing" | "completed" | "failed"
export type PlanStepStatus = "pending" | "blocked" | "running" | "completed" | "failed" | "skipped"

export interface PlanRecord {
  id: string
  sessionId: string
  agentId: string | null
  goal: string
  status: PlanStatus
  createdAt: string
  completedAt: string | null
}

export interface PlanStepRecord {
  id: string
  planId: string
  description: string
  tool: string | null
  args: string | null
  dependsOn: string
  status: PlanStepStatus
  result: string | null
  error: string | null
  order: number
  createdAt: string
  completedAt: string | null
}

export interface EventLogEntry {
  sequence: number
  sessionId: string | null
  eventType: string
  eventData: unknown
  eventVersion: number
  correlationId: string | null
  createdAt: string
}

export interface AuditLogEntry {
  id: string
  sessionId: string | null
  category: "permission" | "config_change" | "error" | "admin"
  action: string
  actor: "user" | "system" | "config"
  target: string | null
  detail: unknown
  createdAt: string
}

export interface ConfigEntry {
  key: string
  value: string
  updatedAt: string
}
