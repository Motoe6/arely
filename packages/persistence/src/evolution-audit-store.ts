import { ulid } from "ulid"
import { eq, desc } from "drizzle-orm"
import { getDb } from "./database.js"
import { evolutionAudit } from "./schema.js"
import type { EvidenceSnapshot, EvolutionAuditRecord } from "./types/evolution.js"

type DbClient = any

export interface CreateAuditInput {
  templateId: string
  templateVersion: string
  proposalId: string
  proposalTitle?: string | null
  parameter: string
  oldValue?: string | null
  newValue?: string | null
  approvedBy?: string | null
  evidenceSnapshot: EvidenceSnapshot
}

export interface AuditListOptions {
  limit?: number
  offset?: number
}

function resolveDb(db?: DbClient): DbClient {
  return db ?? getDb()
}

function mapRow(row: Record<string, unknown>): EvolutionAuditRecord {
  let snapshot: EvidenceSnapshot = { executions: 0, successRate: 0, confidence: 0, score: 0 }
  try { snapshot = JSON.parse(row.evidenceSnapshot as string) } catch { }
  return {
    id: row.id as string,
    templateId: row.templateId as string,
    templateVersion: row.templateVersion as string,
    proposalId: row.proposalId as string,
    proposalTitle: (row.proposalTitle as string) ?? null,
    parameter: row.parameter as string,
    oldValue: (row.oldValue as string) ?? null,
    newValue: (row.newValue as string) ?? null,
    approvedBy: (row.approvedBy as string) ?? null,
    evidenceSnapshot: snapshot,
    createdAt: row.createdAt as string,
  }
}

export function createAuditRecord(data: CreateAuditInput, db?: DbClient): EvolutionAuditRecord {
  const d = resolveDb(db)
  const id = ulid()
  const now = new Date().toISOString()
  d.insert(evolutionAudit).values({
    id,
    templateId: data.templateId,
    templateVersion: data.templateVersion,
    proposalId: data.proposalId,
    proposalTitle: data.proposalTitle ?? null,
    parameter: data.parameter,
    oldValue: data.oldValue ?? null,
    newValue: data.newValue ?? null,
    approvedBy: data.approvedBy ?? null,
    evidenceSnapshot: JSON.stringify(data.evidenceSnapshot),
    createdAt: now,
  }).run()
  return {
    id,
    templateId: data.templateId,
    templateVersion: data.templateVersion,
    proposalId: data.proposalId,
    proposalTitle: data.proposalTitle ?? null,
    parameter: data.parameter,
    oldValue: data.oldValue ?? null,
    newValue: data.newValue ?? null,
    approvedBy: data.approvedBy ?? null,
    evidenceSnapshot: data.evidenceSnapshot,
    createdAt: now,
  }
}

export function getAuditByTemplate(
  templateId: string,
  opts?: AuditListOptions,
  db?: DbClient,
): EvolutionAuditRecord[] {
  const d = resolveDb(db)
  const query = d.select().from(evolutionAudit)
    .where(eq(evolutionAudit.templateId, templateId))
    .orderBy(desc(evolutionAudit.createdAt))
  if (opts?.limit) query.limit(opts.limit)
  if (opts?.offset) query.offset(opts.offset)
  const rows = query.all() as Record<string, unknown>[]
  return rows.map(mapRow)
}

export function getAuditByProposal(proposalId: string, db?: DbClient): EvolutionAuditRecord | null {
  const d = resolveDb(db)
  const rows = d.select().from(evolutionAudit)
    .where(eq(evolutionAudit.proposalId, proposalId))
    .all() as Record<string, unknown>[]
  return rows.length > 0 ? mapRow(rows[0]) : null
}

export function listAudit(
  opts?: AuditListOptions & { templateId?: string },
  db?: DbClient,
): EvolutionAuditRecord[] {
  const d = resolveDb(db)
  let query = d.select().from(evolutionAudit)
  if (opts?.templateId) {
    query = query.where(eq(evolutionAudit.templateId, opts.templateId))
  }
  query = query.orderBy(desc(evolutionAudit.createdAt))
  if (opts?.limit) query.limit(opts.limit)
  if (opts?.offset) query.offset(opts.offset)
  const rows = query.all() as Record<string, unknown>[]
  return rows.map(mapRow)
}
