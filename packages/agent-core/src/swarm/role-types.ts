export type SwarmRole =
  | "planner"
  | "researcher"
  | "coder"
  | "reviewer"
  | "synthesizer"

export type TaskCategory =
  | "coding"
  | "research"
  | "planning"
  | "tool-use"
  | "multi-step-research"
  | "implementation-design"

export interface RoleAssignment {
  role: SwarmRole
  provider: string
  model: string
  confidence: number
  score: number
  category: TaskCategory
  reason?: string
}

export interface ProviderCategoryStats {
  provider: string
  utility: number
  latency: number
  successRate: number
  costEfficiency: number
  score: number
  health: "online" | "offline" | "rate_limited" | "unauthorized"
}

export interface RoleHistoryEntry {
  timestamp: string
  category: TaskCategory
  role: SwarmRole
  provider: string
  model: string
  score: number
  confidence: number
  success: boolean
  utility: number
}

export const SWARM_ROLES: SwarmRole[] = ["planner", "researcher", "coder", "reviewer", "synthesizer"]

export const TASK_CATEGORIES: TaskCategory[] = [
  "coding",
  "research",
  "planning",
  "tool-use",
  "multi-step-research",
  "implementation-design",
]

export const ROLE_CATEGORY_MAP: Record<SwarmRole, TaskCategory> = {
  planner: "planning",
  researcher: "research",
  coder: "coding",
  reviewer: "tool-use",
  synthesizer: "planning",
}
