export type PolicyChangeStatus = "draft" | "approved" | "applied"

export interface PolicyChange {
  id: string
  packId: string
  status: PolicyChangeStatus
  statusReason?: string
  originalPackJson: string
  proposedPackJson: string
  recommendationIds: string[]
  createdAt: string
  approvedAt?: string
  appliedAt?: string
}
