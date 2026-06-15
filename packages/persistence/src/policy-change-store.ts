import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb } from "./database.js";
import { policyChanges } from "./schema.js";
import type { PolicyChange, PolicyChangeStatus } from "./types/policy.js";

export function createPolicyChange(data: {
  packId: string;
  originalPackJson: string;
  proposedPackJson: string;
  recommendationIds?: string[];
  id?: string;
  createdAt?: string;
}): PolicyChange {
  const id = data.id ?? ulid();
  const now = data.createdAt ?? new Date().toISOString();
  getDb()
    .insert(policyChanges)
    .values({
      id,
      packId: data.packId,
      status: "draft",
      originalPackJson: data.originalPackJson,
      proposedPackJson: data.proposedPackJson,
      recommendationIds: JSON.stringify(data.recommendationIds ?? []),
      createdAt: now,
    })
    .run();
  return {
    id,
    packId: data.packId,
    status: "draft",
    originalPackJson: data.originalPackJson,
    proposedPackJson: data.proposedPackJson,
    recommendationIds: data.recommendationIds ?? [],
    createdAt: now,
  };
}

export function getPolicyChange(id: string): PolicyChange | undefined {
  const row = getDb()
    .select()
    .from(policyChanges)
    .where(eq(policyChanges.id, id))
    .get();
  return row ? toDomain(row) : undefined;
}

export function listPolicyChanges(limit = 50, offset = 0): PolicyChange[] {
  const rows = getDb()
    .select()
    .from(policyChanges)
    .orderBy(policyChanges.createdAt)
    .limit(limit)
    .offset(offset)
    .all();
  return rows.map(toDomain);
}

export function updatePolicyChangeStatus(
  id: string,
  status: PolicyChangeStatus,
  reason?: string,
): PolicyChange | undefined {
  const now = new Date().toISOString();
  const updates: Record<string, string | undefined> = { status, statusReason: reason };
  if (status === "approved") updates.approvedAt = now;
  if (status === "applied") updates.appliedAt = now;
  getDb()
    .update(policyChanges)
    .set(updates)
    .where(eq(policyChanges.id, id))
    .run();
  return getPolicyChange(id);
}

function toDomain(row: {
  id: string;
  packId: string;
  status: string;
  statusReason: string | null;
  originalPackJson: string;
  proposedPackJson: string;
  recommendationIds: string;
  createdAt: string;
  approvedAt: string | null;
  appliedAt: string | null;
}): PolicyChange {
  return {
    id: row.id,
    packId: row.packId,
    status: row.status as PolicyChangeStatus,
    statusReason: row.statusReason ?? undefined,
    originalPackJson: row.originalPackJson,
    proposedPackJson: row.proposedPackJson,
    recommendationIds: JSON.parse(row.recommendationIds) as string[],
    createdAt: row.createdAt,
    approvedAt: row.approvedAt ?? undefined,
    appliedAt: row.appliedAt ?? undefined,
  };
}
