// Decision types
export type DecisionOutcome = "pending" | "success" | "failure" | "rolled_back"

export interface MemorySnapshotEntry {
  id: string
  type: string
  key: string
  value: string
}

export interface DecisionRecord {
  id: string
  sessionId: string
  decisionType: string
  decision: string
  rationale: string
  confidence: number
  memoriesUsed: string[]
  memorySnapshot: MemorySnapshotEntry[]
  epochId: string | null
  proposalId: string | null
  templateId: string | null
  outcome: DecisionOutcome
  outcomeDetail: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface DecisionQuery {
  sessionId?: string
  decisionType?: string
  proposalId?: string
  templateId?: string
  outcome?: DecisionOutcome
  limit?: number
  offset?: number
}

// Memory types
export type MemoryType =
  | "user_preference"
  | "project_fact"
  | "architecture_decision"
  | "workflow_pattern"
  | "conversation_summary"

export type MemorySource = "explicit" | "inferred" | "derived"

export interface MemoryRecord {
  id: string
  sessionId: string | null
  type: MemoryType
  key: string
  value: string
  confidence: number
  source: MemorySource
  tags: string[]
  epochId: string | null
  createdAt: string
  updatedAt: string
  accessCount: number
  lastAccessedAt: string | null
  ttlSeconds: number | null
}

export interface MemorySearchQuery {
  type?: MemoryType
  typeIn?: MemoryType[]
  tags?: string[]
  minConfidence?: number
  limit?: number
  offset?: number
}

export const DEFAULT_MEMORY_LIMIT = 100
export const MAX_MEMORIES = 5000
export const TYPE_LIMIT = 1000

// Epoch types
export interface ContextEpoch {
  id: string
  sessionId: string
  epochNumber: number
  baselineContext: string
  messageCount: number
  createdAt: string
}

export interface EpochMessage {
  id: string
  sessionId: string
  epochId: string
  role: "user" | "assistant" | "system"
  content: string
  sequence: number
  createdAt: string
}

export interface BuildContextOptions {
  recentMessageCount?: number
}
