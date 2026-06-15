export type GoalPlanStatus = "pending" | "in_progress" | "completed" | "failed"

export interface GoalPlan {
  id: string
  goalId: string
  title: string
  description: string
  status: GoalPlanStatus
  sortOrder: number
  dependencies: string[]
  progressPct: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface GoalPlanQuery {
  goalId?: string
  status?: GoalPlanStatus
  limit?: number
  offset?: number
}
