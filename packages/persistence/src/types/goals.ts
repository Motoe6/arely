export type GoalStatus = "active" | "paused" | "completed" | "abandoned"

export interface Goal {
  id: string
  title: string
  description: string
  status: GoalStatus
  priority: number
  progressPct: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
  metadata: Record<string, unknown>
}

export interface GoalQuery {
  status?: GoalStatus
  minPriority?: number
  limit?: number
  offset?: number
}
