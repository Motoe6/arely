import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "./database.js";
import { goalPlans, goals } from "./schema.js";
import type { GoalPlan, GoalPlanStatus, GoalPlanQuery } from "./types/plans.js";
import type { GoalStatus } from "./types/goals.js";

function parseJsonField<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function _recomputeGoalProgress(goalId: string): void {
  const db = getDb();
  const all = queryGoalPlans({ goalId });
  if (all.length === 0) return;
  const avgPct = Math.round(all.reduce((sum, p) => sum + p.progressPct, 0) / all.length);
  const allCompleted = all.every(p => p.status === "completed");
  const setFields: Record<string, unknown> = { progressPct: avgPct };
  if (allCompleted) {
    setFields.status = "completed" satisfies GoalStatus;
    setFields.completedAt = new Date().toISOString();
  }
  db.update(goals).set(setFields).where(eq(goals.id, goalId)).run();
}

function mapRow(row: Record<string, unknown>): GoalPlan {
  return {
    id: row.id as string,
    goalId: row.goalId as string ?? row.goal_id as string,
    title: row.title as string,
    description: row.description as string,
    status: (row.status ?? "pending") as GoalPlanStatus,
    sortOrder: (row.sortOrder ?? 0) as number,
    dependencies: parseJsonField<string[]>(row.dependencies as string, []),
    progressPct: (row.progressPct ?? row.progress_pct ?? 0) as number,
    metadata: parseJsonField<Record<string, unknown>>(row.metadata as string, {}),
    createdAt: row.createdAt as string ?? row.created_at as string,
    updatedAt: row.updatedAt as string ?? row.updated_at as string,
  };
}

export function createGoalPlan(data: {
  id: string
  goalId: string
  title: string
  description: string
  status?: GoalPlanStatus
  sortOrder?: number
  dependencies?: string[]
  progressPct?: number
  metadata?: Record<string, unknown>
}): GoalPlan {
  const db = getDb();
  const status: GoalPlanStatus = data.status ?? (data.progressPct && data.progressPct >= 100 ? "completed" : "pending");
  db.insert(goalPlans)
    .values({
      id: data.id,
      goalId: data.goalId,
      title: data.title,
      description: data.description,
      status,
      sortOrder: data.sortOrder ?? 0,
      dependencies: JSON.stringify(data.dependencies ?? []),
      progressPct: data.progressPct ?? 0,
      metadata: JSON.stringify(data.metadata ?? {}),
    })
    .run();
  const plan = getGoalPlan(data.id)!;
  _recomputeGoalProgress(data.goalId);
  return plan;
}

export function getGoalPlan(id: string): GoalPlan | null {
  const db = getDb();
  const rows = db.select().from(goalPlans).where(eq(goalPlans.id, id)).limit(1).all();
  if (rows.length === 0) return null;
  return mapRow(rows[0] as unknown as Record<string, unknown>);
}

export function updateGoalPlan(id: string, updates: {
  title?: string
  description?: string
  status?: GoalPlanStatus
  sortOrder?: number
  dependencies?: string[]
  progressPct?: number
  metadata?: Record<string, unknown>
}): boolean {
  const db = getDb();
  const existing = db.select({ goalId: goalPlans.goalId, status: goalPlans.status }).from(goalPlans).where(eq(goalPlans.id, id)).limit(1).get();
  if (!existing) return false;
  const setFields: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (updates.title !== undefined) setFields.title = updates.title;
  if (updates.description !== undefined) setFields.description = updates.description;
  if (updates.status !== undefined) setFields.status = updates.status;
  if (updates.sortOrder !== undefined) setFields.sortOrder = updates.sortOrder;
  if (updates.dependencies !== undefined) setFields.dependencies = JSON.stringify(updates.dependencies);
  if (updates.progressPct !== undefined) {
    setFields.progressPct = updates.progressPct;
    if (updates.progressPct >= 100 && existing.status !== "completed") {
      setFields.status = "completed";
    }
  }
  if (updates.metadata !== undefined) setFields.metadata = JSON.stringify(updates.metadata);
  const result = db.update(goalPlans).set(setFields).where(eq(goalPlans.id, id)).run();
  const updated = (result.changes ?? 0) > 0;
  if (updated && updates.progressPct !== undefined) {
    _recomputeGoalProgress(existing.goalId);
  }
  return updated;
}

export function queryGoalPlans(q: GoalPlanQuery = {}): GoalPlan[] {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];
  if (q.goalId) conditions.push(eq(goalPlans.goalId, q.goalId));
  if (q.status) conditions.push(eq(goalPlans.status, q.status));

  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;

  let query: any = db.select().from(goalPlans);
  if (conditions.length > 0) query = query.where(and(...conditions));
  const rows = query.orderBy(goalPlans.sortOrder, desc(goalPlans.createdAt)).limit(limit).offset(offset).all();

  return rows.map((r: unknown) => mapRow(r as Record<string, unknown>));
}

export function countGoalPlans(q: GoalPlanQuery = {}): number {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];
  if (q.goalId) conditions.push(eq(goalPlans.goalId, q.goalId));
  if (q.status) conditions.push(eq(goalPlans.status, q.status));

  let query: any = db.select({ count: sql<number>`count(*)` }).from(goalPlans);
  if (conditions.length > 0) query = query.where(and(...conditions));
  const result = query.get();
  return result?.count ?? 0;
}

export function deleteGoalPlan(id: string): boolean {
  const db = getDb();
  const existing = db.select({ goalId: goalPlans.goalId }).from(goalPlans).where(eq(goalPlans.id, id)).limit(1).get();
  if (!existing) return false;
  const result = db.delete(goalPlans).where(eq(goalPlans.id, id)).run();
  const deleted = (result.changes ?? 0) > 0;
  if (deleted) {
    _recomputeGoalProgress(existing.goalId);
  }
  return deleted;
}
