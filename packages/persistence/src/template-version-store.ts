import { ulid } from "ulid"
import { eq, and, desc } from "drizzle-orm"
import { getDb } from "./database.js"
import { templateVersions } from "./schema.js"
import type { TemplateParameter } from "./types/template.js"

type DbClient = any

export interface TemplateVersionRecord {
  id: string
  templateId: string
  version: string
  workflowYaml: string
  parameters: TemplateParameter[]
  source: "manual" | "evolution"
  proposalId: string | null
  createdAt: string
}

export interface CreateTemplateVersionInput {
  templateId: string
  version: string
  workflowYaml: string
  parameters: TemplateParameter[]
  source?: "manual" | "evolution"
  proposalId?: string | null
}

function resolveDb(db?: DbClient): DbClient {
  return db ?? getDb()
}

function mapRow(row: Record<string, unknown>): TemplateVersionRecord {
  let parameters: TemplateParameter[] = []
  try { parameters = JSON.parse(row.parametersJson as string) } catch { }
  return {
    id: row.id as string,
    templateId: row.templateId as string,
    version: row.version as string,
    workflowYaml: row.workflowYaml as string,
    parameters,
    source: row.source as "manual" | "evolution",
    proposalId: (row.proposalId as string) ?? null,
    createdAt: row.createdAt as string,
  }
}

export function createTemplateVersion(data: CreateTemplateVersionInput, db?: DbClient): TemplateVersionRecord {
  const d = resolveDb(db)
  const id = ulid()
  const now = new Date().toISOString()
  d.insert(templateVersions).values({
    id,
    templateId: data.templateId,
    version: data.version,
    workflowYaml: data.workflowYaml,
    parametersJson: JSON.stringify(data.parameters),
    source: data.source ?? "evolution",
    proposalId: data.proposalId ?? null,
    createdAt: now,
  }).run()
  return {
    id,
    templateId: data.templateId,
    version: data.version,
    workflowYaml: data.workflowYaml,
    parameters: data.parameters,
    source: data.source ?? "evolution",
    proposalId: data.proposalId ?? null,
    createdAt: now,
  }
}

export function getTemplateVersion(templateId: string, version: string, db?: DbClient): TemplateVersionRecord | null {
  const d = resolveDb(db)
  const rows = d.select().from(templateVersions)
    .where(and(
      eq(templateVersions.templateId, templateId),
      eq(templateVersions.version, version),
    ))
    .all() as Record<string, unknown>[]
  return rows.length > 0 ? mapRow(rows[0]) : null
}

export function listTemplateVersions(templateId: string, db?: DbClient): TemplateVersionRecord[] {
  const d = resolveDb(db)
  const rows = d.select().from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(desc(templateVersions.createdAt))
    .all() as Record<string, unknown>[]
  return rows.map(mapRow)
}
