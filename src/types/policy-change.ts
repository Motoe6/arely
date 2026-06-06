export type PolicyChangeStatus = "draft" | "approved" | "applied";

export interface PolicyChange {
  id: string;
  packId: string;
  status: PolicyChangeStatus;
  statusReason?: string;
  originalPackJson: string;
  proposedPackJson: string;
  recommendationIds: string[];
  createdAt: string;
  approvedAt?: string;
  appliedAt?: string;
}

const VALID_TRANSITIONS: Record<PolicyChangeStatus, PolicyChangeStatus[]> = {
  draft: ["approved"],
  approved: ["applied"],
  applied: [],
};

export function canTransition(
  from: PolicyChangeStatus,
  to: PolicyChangeStatus,
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidTransition(
  from: PolicyChangeStatus,
  to: PolicyChangeStatus,
): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid status transition: ${from} -> ${to}`,
    );
  }
}
