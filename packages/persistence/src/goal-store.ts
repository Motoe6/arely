import { eq, and, desc, gte, sql } from "drizzle-orm";
import { getDb } from "./database.js";
import { goals } from "./schema.js";
import type { Goal, GoalStatus, GoalQuery } from "./types/goals.js";

function parseJsonField<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function mapRow(row: Record<string, unknown>): Goal {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    status: (row.status ?? "active") as GoalStatus,
    priority: (row.priority ?? 0) as number,
    progressPct: (row.progressPct ?? row.progress_pct ?? 0) as number,
    createdAt: row.createdAt as string ?? row.created_at as string,
    updatedAt: row.updatedAt as string ?? row.updated_at as string,
    completedAt: (row.completedAt ?? row.completed_at ?? null) as string | null,
    metadata: parseJsonField<Record<string, unknown>>(row.metadata as string, {}),
  };
}

export function createGoal(data: {
  id: string
  title: string
  description: string
  status?: GoalStatus
  priority?: number
  progressPct?: number
  metadata?: Record<string, unknown>
}): Goal {
  const db = getDb();
  db.insert(goals)
    .values({
      id: data.id,
      title: data.title,
      description: data.description,
      status: data.status ?? "active",
      priority: data.priority ?? 0,
      progressPct: data.progressPct ?? 0,
      metadata: JSON.stringify(data.metadata ?? {}),
    })
    .run();
  return getGoal(data.id)!;
}

export function getGoal(id: string): Goal | null {
  const db = getDb();
  const rows = db.select().from(goals).where(eq(goals.id, id)).limit(1).all();
  if (rows.length === 0) return null;
  return mapRow(rows[0] as unknown as Record<string, unknown>);
}

export function updateGoal(id: string, updates: {
  title?: string
  description?: string
  status?: GoalStatus
  priority?: number
  progressPct?: number
  completedAt?: string | null
  metadata?: Record<string, unknown>
}): boolean {
  const db = getDb();
  const setFields: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (updates.title !== undefined) setFields.title = updates.title;
  if (updates.description !== undefined) setFields.description = updates.description;
  if (updates.status !== undefined) setFields.status = updates.status;
  if (updates.priority !== undefined) setFields.priority = updates.priority;
  if (updates.progressPct !== undefined) setFields.progressPct = updates.progressPct;
  if (updates.completedAt !== undefined) setFields.completedAt = updates.completedAt;
  if (updates.metadata !== undefined) setFields.metadata = JSON.stringify(updates.metadata);
  const result = db.update(goals).set(setFields).where(eq(goals.id, id)).run();
  return (result.changes ?? 0) > 0;
}

export function queryGoals(q: GoalQuery = {}): Goal[] {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];

  if (q.status) conditions.push(eq(goals.status, q.status));

  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;

  let query: any = db.select().from(goals);
  if (conditions.length > 0) query = query.where(and(...conditions));
  const rows = query.orderBy(desc(goals.priority), desc(goals.createdAt)).limit(limit).offset(offset).all();

  return rows.map((r: unknown) => mapRow(r as Record<string, unknown>));
}

export function countGoals(q: GoalQuery = {}): number {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];
  if (q.status) conditions.push(eq(goals.status, q.status));

  let query: any = db.select({ count: sql<number>`count(*)` }).from(goals);
  if (conditions.length > 0) query = query.where(and(...conditions));
  const result = query.get();
  return result?.count ?? 0;
}

export function deleteGoal(id: string): boolean {
  const db = getDb();
  const result = db.delete(goals).where(eq(goals.id, id)).run();
  return (result.changes ?? 0) > 0;
}
