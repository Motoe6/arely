import { ulid } from "ulid"
import { eq, and, lte, sql, or, isNull } from "drizzle-orm"
import { CronExpressionParser } from "cron-parser"
import { getDb } from "../persistence/database.js"
import { scheduledTriggers } from "../persistence/schema.js"

type DbClient = any

function resolveDb(db?: DbClient): DbClient {
  return db ?? getDb()
}

export interface ScheduleRecord {
  id: string
  workflowId: string
  triggerMode: string
  cronExpression: string | null
  intervalMs: number | null
  enabled: number
  nextRunAt: string
  lastRunAt: string | null
  lastError: string | null
  runCount: number
  lockedUntil: string | null
  createdAt: string
  updatedAt: string
}

export function computeNextRun(now: Date, triggerMode: string, cronExpression?: string | null, intervalMs?: number | null): Date {
  if (triggerMode === "cron" && cronExpression) {
    const interval = CronExpressionParser.parse(cronExpression, { currentDate: now })
    return interval.next().toDate()
  }
  if (triggerMode === "interval" && intervalMs != null && intervalMs > 0) {
    return new Date(now.getTime() + intervalMs)
  }
  return new Date(now.getTime() + 60000)
}

export function createSchedule(
  workflowId: string,
  triggerMode: string,
  cronExpression?: string | null,
  intervalMs?: number | null,
  db?: DbClient,
): ScheduleRecord {
  const d = resolveDb(db)
  const id = ulid()
  const now = new Date()
  const nextRunAt = computeNextRun(now, triggerMode, cronExpression, intervalMs)
  const nowIso = now.toISOString()
  d.insert(scheduledTriggers).values({
    id,
    workflowId,
    triggerMode,
    cronExpression: cronExpression ?? null,
    intervalMs: intervalMs ?? null,
    enabled: 1,
    nextRunAt: nextRunAt.toISOString(),
    lastRunAt: null,
    lastError: null,
    runCount: 0,
    lockedUntil: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  }).run()
  return {
    id, workflowId, triggerMode, cronExpression: cronExpression ?? null, intervalMs: intervalMs ?? null,
    enabled: 1, nextRunAt: nextRunAt.toISOString(), lastRunAt: null, lastError: null, runCount: 0,
    lockedUntil: null, createdAt: nowIso, updatedAt: nowIso,
  }
}

export function getSchedule(id: string, db?: DbClient): ScheduleRecord | undefined {
  const d = resolveDb(db)
  return d.select().from(scheduledTriggers).where(eq(scheduledTriggers.id, id)).get() as ScheduleRecord | undefined
}

export function listSchedules(db?: DbClient): ScheduleRecord[] {
  const d = resolveDb(db)
  return d.select().from(scheduledTriggers).orderBy(scheduledTriggers.nextRunAt).all() as ScheduleRecord[]
}

export function listSchedulesByWorkflow(workflowId: string, db?: DbClient): ScheduleRecord[] {
  const d = resolveDb(db)
  return d.select().from(scheduledTriggers).where(eq(scheduledTriggers.workflowId, workflowId)).all() as ScheduleRecord[]
}

export function updateSchedule(
  id: string,
  updates: { triggerMode?: string; cronExpression?: string | null; intervalMs?: number | null; enabled?: number },
  db?: DbClient,
): void {
  const d = resolveDb(db)
  const existing = d.select().from(scheduledTriggers).where(eq(scheduledTriggers.id, id)).get() as Record<string, unknown> | undefined
  if (!existing) return
  const mode = updates.triggerMode ?? (existing.triggerMode as string)
  const cron = updates.cronExpression !== undefined ? updates.cronExpression : (existing.cronExpression as string | null)
  const interval = updates.intervalMs !== undefined ? updates.intervalMs : (existing.intervalMs as number | null)
  const now = new Date()
  const nextRunAt = updates.enabled === 1 || (updates.enabled === undefined && (existing.enabled as number) === 1)
    ? computeNextRun(now, mode, cron, interval).toISOString()
    : (existing.nextRunAt as string)
  const setFields: Record<string, unknown> = { updatedAt: now.toISOString(), nextRunAt }
  if (updates.triggerMode !== undefined) setFields.triggerMode = updates.triggerMode
  if (updates.cronExpression !== undefined) setFields.cronExpression = updates.cronExpression
  if (updates.intervalMs !== undefined) setFields.intervalMs = updates.intervalMs
  if (updates.enabled !== undefined) setFields.enabled = updates.enabled
  d.update(scheduledTriggers).set(setFields).where(eq(scheduledTriggers.id, id)).run()
}

export function deleteSchedule(id: string, db?: DbClient): void {
  const d = resolveDb(db)
  d.delete(scheduledTriggers).where(eq(scheduledTriggers.id, id)).run()
}

export function getDueSchedules(db?: DbClient): ScheduleRecord[] {
  const d = resolveDb(db)
  const now = new Date().toISOString()
  return d.select().from(scheduledTriggers).where(
    and(
      eq(scheduledTriggers.enabled, 1),
      lte(scheduledTriggers.nextRunAt, now),
      or(isNull(scheduledTriggers.lockedUntil), lte(scheduledTriggers.lockedUntil, now)),
    ),
  ).all() as ScheduleRecord[]
}

export function claimSchedule(id: string, lockDurationMs: number = 30000, db?: DbClient): boolean {
  const d = resolveDb(db)
  const now = new Date()
  const lockUntil = new Date(now.getTime() + lockDurationMs).toISOString()
  const result = d.update(scheduledTriggers)
    .set({ lockedUntil: lockUntil, updatedAt: now.toISOString() })
    .where(
      and(
        eq(scheduledTriggers.id, id),
        or(isNull(scheduledTriggers.lockedUntil), lte(scheduledTriggers.lockedUntil, now.toISOString())),
      ),
    ).run()
  return (result.changes ?? 0) > 0
}

export function releaseSchedule(id: string, db?: DbClient): void {
  const d = resolveDb(db)
  d.update(scheduledTriggers).set({ lockedUntil: null, updatedAt: new Date().toISOString() }).where(eq(scheduledTriggers.id, id)).run()
}

export function recordRun(id: string, success: boolean, error?: string, db?: DbClient): void {
  const d = resolveDb(db)
  const now = new Date()
  const existing = d.select().from(scheduledTriggers).where(eq(scheduledTriggers.id, id)).get() as Record<string, unknown> | undefined
  if (!existing) return
  const nextRunAt = computeNextRun(now, existing.triggerMode as string, existing.cronExpression as string | null, existing.intervalMs as number | null)
  d.update(scheduledTriggers).set({
    lastRunAt: now.toISOString(),
    lastError: error ?? null,
    runCount: (existing.runCount as number) + 1,
    nextRunAt: nextRunAt.toISOString(),
    lockedUntil: null,
    updatedAt: now.toISOString(),
  }).where(eq(scheduledTriggers.id, id)).run()
}
