import { ulid } from "ulid"
import { eq, and, sql } from "drizzle-orm"
import { getDb } from "./database.js"
import { workflowFeedback } from "./schema.js"

type DbClient = any

function resolveDb(db?: DbClient): DbClient {
  return db ?? getDb()
}

export interface FeedbackRecord {
  id: string
  workflowId: string
  workflowVersionId: string | null
  templateId: string | null
  source: "evolved" | "template" | "manual" | "imported"
  success: boolean
  durationMs: number | null
  parameters: Record<string, string> | null
  createdAt: string
}

export interface CreateFeedbackInput {
  workflowId: string
  workflowVersionId?: string | null
  templateId?: string | null
  source: "evolved" | "template" | "manual" | "imported"
  success: boolean
  durationMs?: number | null
  parameters?: Record<string, string> | null
}

export interface TemplateMetricsRow {
  templateId: string
  executions: number
  successes: number
  failures: number
  successRate: number
  avgDuration: number | null
}

export function createFeedback(data: CreateFeedbackInput, db?: DbClient): FeedbackRecord {
  const d = resolveDb(db)
  const id = ulid()
  const now = new Date().toISOString()
  const paramsStr = data.parameters && Object.keys(data.parameters).length > 0
    ? JSON.stringify(data.parameters)
    : null
  d.insert(workflowFeedback).values({
    id,
    workflowId: data.workflowId,
    workflowVersionId: data.workflowVersionId ?? null,
    templateId: data.templateId ?? null,
    source: data.source,
    success: data.success ? 1 : 0,
    durationMs: data.durationMs ?? null,
    parameters: paramsStr,
    createdAt: now,
  }).run()
  return {
    id,
    workflowId: data.workflowId,
    workflowVersionId: data.workflowVersionId ?? null,
    templateId: data.templateId ?? null,
    source: data.source,
    success: data.success,
    durationMs: data.durationMs ?? null,
    parameters: data.parameters ?? null,
    createdAt: now,
  }
}

export function getFeedbackByWorkflow(workflowId: string, db?: DbClient): FeedbackRecord[] {
  const d = resolveDb(db)
  const rows = d.select().from(workflowFeedback)
    .where(eq(workflowFeedback.workflowId, workflowId))
    .orderBy(workflowFeedback.createdAt)
    .all() as Record<string, unknown>[]
  return rows.map(mapRow)
}

export function getFeedbackByTemplate(templateId: string, db?: DbClient): FeedbackRecord[] {
  const d = resolveDb(db)
  const rows = d.select().from(workflowFeedback)
    .where(eq(workflowFeedback.templateId, templateId))
    .orderBy(workflowFeedback.createdAt)
    .all() as Record<string, unknown>[]
  return rows.map(mapRow)
}

export function getTemplateMetrics(db?: DbClient): TemplateMetricsRow[] {
  const d = resolveDb(db)
  const rows = d.select({
    templateId: workflowFeedback.templateId,
    executions: sql<number>`count(*)`,
    successes: sql<number>`sum(case when ${workflowFeedback.success} = 1 then 1 else 0 end)`,
    failures: sql<number>`sum(case when ${workflowFeedback.success} = 0 then 1 else 0 end)`,
    successRate: sql<number>`cast(sum(case when ${workflowFeedback.success} = 1 then 1 else 0 end) as real) / cast(count(*) as real)`,
    avgDuration: sql<number | null>`avg(${workflowFeedback.durationMs})`,
  })
    .from(workflowFeedback)
    .where(and(
      sql`${workflowFeedback.templateId} is not null`,
      sql`${workflowFeedback.templateId} != ''`,
    ))
    .groupBy(workflowFeedback.templateId)
    .orderBy(sql`cast(sum(case when ${workflowFeedback.success} = 1 then 1 else 0 end) as real) / cast(count(*) as real) desc`)
    .all() as any[]
  return rows
}

export function getFeedbackStats(db?: DbClient): {
  total: number
  bySource: Record<string, number>
  byTemplate: Record<string, number>
} {
  const d = resolveDb(db)
  const all = d.select().from(workflowFeedback).all() as Record<string, unknown>[]
  const bySource: Record<string, number> = {}
  const byTemplate: Record<string, number> = {}
  for (const row of all) {
    const src = row.source as string
    bySource[src] = (bySource[src] || 0) + 1
    const tid = row.templateId as string | null
    if (tid) {
      byTemplate[tid] = (byTemplate[tid] || 0) + 1
    }
  }
  return { total: all.length, bySource, byTemplate }
}

function mapRow(row: Record<string, unknown>): FeedbackRecord {
  let parameters: Record<string, string> | null = null
  const raw = row.parameters as string | null | undefined
  if (raw) {
    try { parameters = JSON.parse(raw) } catch { parameters = null }
  }
  return {
    id: row.id as string,
    workflowId: row.workflowId as string,
    workflowVersionId: (row.workflowVersionId as string) ?? null,
    templateId: (row.templateId as string) ?? null,
    source: row.source as "evolved" | "template" | "manual" | "imported",
    success: Boolean(row.success),
    durationMs: (row.durationMs as number) ?? null,
    parameters,
    createdAt: row.createdAt as string,
  }
}
