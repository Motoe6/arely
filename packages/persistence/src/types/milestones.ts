export type MilestoneStatus = "pending" | "completed"

export interface Milestone {
  id: string
  planId: string
  description: string
  status: MilestoneStatus
  completedAt: string | null
  weight: number
  metadata: Record<string, unknown>
  createdAt: string
}

export interface MilestoneQuery {
  planId?: string
  status?: MilestoneStatus
  limit?: number
  offset?: number
}
