import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "./database.js";
import { milestones, goalPlans } from "./schema.js";
import type { Milestone, MilestoneStatus, MilestoneQuery } from "./types/milestones.js";
import type { GoalPlanStatus } from "./types/plans.js";

function parseJsonField<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function _recomputeGoalPlanProgress(planId: string): void {
  const db = getDb();
  const total = countMilestones({ planId });
  if (total === 0) return;
  const completed = countMilestones({ planId, status: "completed" });
  const progressPct = Math.floor((completed / total) * 100);
  const setFields: Record<string, unknown> = { progressPct };
  if (completed >= total) {
    setFields.status = "completed" satisfies GoalPlanStatus;
  }
  db.update(goalPlans).set(setFields).where(eq(goalPlans.id, planId)).run();
}

function mapRow(row: Record<string, unknown>): Milestone {
  return {
    id: row.id as string,
    planId: row.planId as string ?? row.plan_id as string,
    description: row.description as string,
    status: (row.status ?? "pending") as MilestoneStatus,
    completedAt: (row.completedAt ?? row.completed_at ?? null) as string | null,
    weight: (row.weight ?? 1) as number,
    metadata: parseJsonField<Record<string, unknown>>(row.metadata as string, {}),
    createdAt: row.createdAt as string ?? row.created_at as string,
  };
}

export function createMilestone(data: {
  id: string
  planId: string
  description: string
  status?: MilestoneStatus
  weight?: number
  metadata?: Record<string, unknown>
}): Milestone {
  const db = getDb();
  db.insert(milestones)
    .values({
      id: data.id,
      planId: data.planId,
      description: data.description,
      status: data.status ?? "pending",
      weight: data.weight ?? 1,
      metadata: JSON.stringify(data.metadata ?? {}),
    })
    .run();
  return getMilestone(data.id)!;
}

export function getMilestone(id: string): Milestone | null {
  const db = getDb();
  const rows = db.select().from(milestones).where(eq(milestones.id, id)).limit(1).all();
  if (rows.length === 0) return null;
  return mapRow(rows[0] as unknown as Record<string, unknown>);
}

export function updateMilestone(id: string, updates: {
  description?: string
  status?: MilestoneStatus
  completedAt?: string | null
  weight?: number
  metadata?: Record<string, unknown>
}): boolean {
  const db = getDb();
  const existing = db.select({ planId: milestones.planId }).from(milestones).where(eq(milestones.id, id)).limit(1).get();
  if (!existing) return false;
  const setFields: Record<string, unknown> = {};
  if (updates.description !== undefined) setFields.description = updates.description;
  if (updates.status !== undefined) setFields.status = updates.status;
  if (updates.completedAt !== undefined) setFields.completedAt = updates.completedAt;
  if (updates.weight !== undefined) setFields.weight = updates.weight;
  if (updates.metadata !== undefined) setFields.metadata = JSON.stringify(updates.metadata);
  const result = db.update(milestones).set(setFields).where(eq(milestones.id, id)).run();
  const updated = (result.changes ?? 0) > 0;
  if (updated && updates.status !== undefined) {
    _recomputeGoalPlanProgress(existing.planId);
  }
  return updated;
}

export function queryMilestones(q: MilestoneQuery = {}): Milestone[] {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];
  if (q.planId) conditions.push(eq(milestones.planId, q.planId));
  if (q.status) conditions.push(eq(milestones.status, q.status));

  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;

  let query = db.select().from(milestones);
  if (conditions.length > 0) query = query.where(and(...conditions));
  const rows = query.orderBy(desc(milestones.createdAt)).limit(limit).offset(offset).all();

  return rows.map((r: unknown) => mapRow(r as Record<string, unknown>));
}

export function countMilestones(q: MilestoneQuery = {}): number {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];
  if (q.planId) conditions.push(eq(milestones.planId, q.planId));
  if (q.status) conditions.push(eq(milestones.status, q.status));

  let query = db.select({ count: sql<number>`count(*)` }).from(milestones);
  if (conditions.length > 0) query = query.where(and(...conditions));
  const result = query.get();
  return result?.count ?? 0;
}

export function deleteMilestone(id: string): boolean {
  const db = getDb();
  const existing = db.select({ planId: milestones.planId }).from(milestones).where(eq(milestones.id, id)).limit(1).get();
  if (!existing) return false;
  const result = db.delete(milestones).where(eq(milestones.id, id)).run();
  const deleted = (result.changes ?? 0) > 0;
  if (deleted) {
    _recomputeGoalPlanProgress(existing.planId);
  }
  return deleted;
}
