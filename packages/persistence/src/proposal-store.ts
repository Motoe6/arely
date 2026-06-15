import { ulid } from "ulid"
import { eq, and } from "drizzle-orm"
import { getDb } from "./database.js"
import { evolutionProposals } from "./schema.js"

type DbClient = any

export type ProposalStatus = "draft" | "approved" | "rejected" | "applied"

export type ProposalType = "parameter_change" | "parameter_removal" | "parameter_addition" | "structural"

export interface ProposalEvidence {
  executions: number
  successRate: number
  pattern?: string
  avgConfidence?: number
  sampleExecutions?: number
}

export interface ProposalRecord {
  id: string
  templateId: string
  type: ProposalType
  parameter: string
  currentValue: string | null
  suggestedValue: string | null
  confidence: number
  evidence: ProposalEvidence
  status: ProposalStatus
  createdAt: string
  updatedAt: string
}

export interface CreateProposalInput {
  templateId: string
  type: ProposalType
  parameter: string
  currentValue?: string | null
  suggestedValue?: string | null
  confidence: number
  evidence: ProposalEvidence
}

function mapRow(row: Record<string, unknown>): ProposalRecord {
  let evidence: ProposalEvidence = { executions: 0, successRate: 0 }
  try { evidence = JSON.parse(row.evidence as string) } catch { }
  return {
    id: row.id as string,
    templateId: row.templateId as string,
    type: row.type as ProposalType,
    parameter: row.parameter as string,
    currentValue: (row.currentValue as string) ?? null,
    suggestedValue: (row.suggestedValue as string) ?? null,
    confidence: Number(row.confidence),
    evidence,
    status: row.status as ProposalStatus,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  }
}

function resolveDb(db?: DbClient): DbClient {
  return db ?? getDb()
}

export function createProposal(data: CreateProposalInput, db?: DbClient): ProposalRecord {
  const d = resolveDb(db)
  const id = ulid()
  const now = new Date().toISOString()
  d.insert(evolutionProposals).values({
    id,
    templateId: data.templateId,
    type: data.type,
    parameter: data.parameter,
    currentValue: data.currentValue ?? null,
    suggestedValue: data.suggestedValue ?? null,
    confidence: String(data.confidence),
    evidence: JSON.stringify(data.evidence),
    status: "draft",
    createdAt: now,
    updatedAt: now,
  }).run()
  return {
    id,
    templateId: data.templateId,
    type: data.type,
    parameter: data.parameter,
    currentValue: data.currentValue ?? null,
    suggestedValue: data.suggestedValue ?? null,
    confidence: data.confidence,
    evidence: data.evidence,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  }
}

export function listProposals(opts?: {
  status?: ProposalStatus
  templateId?: string
  type?: ProposalType
  db?: DbClient
}): ProposalRecord[] {
  const d = resolveDb(opts?.db)
  const conditions: any[] = []
  if (opts?.status) {
    conditions.push(eq(evolutionProposals.status, opts.status))
  }
  if (opts?.templateId) {
    conditions.push(eq(evolutionProposals.templateId, opts.templateId))
  }
  if (opts?.type) {
    conditions.push(eq(evolutionProposals.type, opts.type))
  }
  let query = d.select().from(evolutionProposals)
  if (conditions.length > 0) {
    query = query.where(and(...conditions))
  }
  const rows = query.orderBy(evolutionProposals.createdAt).all() as Record<string, unknown>[]
  return rows.map(mapRow)
}

export function getProposal(id: string, db?: DbClient): ProposalRecord | null {
  const d = resolveDb(db)
  const rows = d.select().from(evolutionProposals)
    .where(eq(evolutionProposals.id, id))
    .all() as Record<string, unknown>[]
  return rows.length > 0 ? mapRow(rows[0]) : null
}

export function updateProposalStatus(
  id: string,
  status: ProposalStatus,
  db?: DbClient,
): ProposalRecord | null {
  const d = resolveDb(db)
  const now = new Date().toISOString()
  d.update(evolutionProposals)
    .set({ status, updatedAt: now })
    .where(eq(evolutionProposals.id, id))
    .run()
  return getProposal(id, db)
}
