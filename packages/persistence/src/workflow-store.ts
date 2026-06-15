import { eq, desc, sql } from "drizzle-orm"
import { ulid } from "ulid"
import { getDb } from "./database.js"
import { workflows, workflowVersions } from "./schema.js"
import type { Workflow } from "@arely/flow-runtime"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any

export interface WorkflowRecord {
  id: string
  name: string | null
  description: string | null
  currentVersionId: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkflowVersionRecord {
  id: string
  workflowId: string
  version: number
  workflowDsl: string
  status: string
  createdAt: string
}

export interface CreateWorkflowOpts {
  id?: string
  name?: string
  description?: string
}

function resolveDb(db?: DbClient): DbClient {
  return db ?? getDb()
}

export function createWorkflow(opts: CreateWorkflowOpts = {}, db?: DbClient): WorkflowRecord {
  const d = resolveDb(db)
  const id = opts.id ?? ulid()
  const now = new Date().toISOString()
  const row = {
    id,
    name: opts.name ?? null,
    description: opts.description ?? null,
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  }
  d.insert(workflows).values(row).run()
  return row
}

export function getWorkflow(id: string, db?: DbClient): WorkflowRecord | undefined {
  const d = resolveDb(db)
  return d.select().from(workflows).where(eq(workflows.id, id)).get() as WorkflowRecord | undefined
}

export function listWorkflows(db?: DbClient): WorkflowRecord[] {
  const d = resolveDb(db)
  return d
    .select()
    .from(workflows)
    .orderBy(desc(workflows.updatedAt))
    .all() as WorkflowRecord[]
}

export function updateWorkflow(
  id: string,
  updates: { name?: string; description?: string },
  db?: DbClient,
): void {
  const d = resolveDb(db)
  const now = new Date().toISOString()
  const setFields: Record<string, unknown> = { updatedAt: now }
  if (updates.name !== undefined) setFields.name = updates.name
  if (updates.description !== undefined) setFields.description = updates.description
  d.update(workflows).set(setFields).where(eq(workflows.id, id)).run()
}

export function deleteWorkflow(id: string, db?: DbClient): void {
  const d = resolveDb(db)
  d.delete(workflows).where(eq(workflows.id, id)).run()
}

export function createWorkflowVersion(
  workflowId: string,
  workflowDsl: string,
  status = "active",
  db?: DbClient,
): WorkflowVersionRecord {
  const d = resolveDb(db)
  const id = ulid()
  const now = new Date().toISOString()
  const currentVersion = d
    .select({ maxVersion: sql<number>`COALESCE(MAX(version), 0)` })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, workflowId))
    .get() as { maxVersion: number } | undefined
  const version = (currentVersion?.maxVersion ?? 0) + 1

  const row = {
    id,
    workflowId,
    version,
    workflowDsl,
    status,
    createdAt: now,
  }
  d.insert(workflowVersions).values(row).run()
  d.update(workflows)
    .set({ currentVersionId: id, updatedAt: now })
    .where(eq(workflows.id, workflowId))
    .run()

  return row
}

export function getWorkflowVersion(id: string, db?: DbClient): WorkflowVersionRecord | undefined {
  const d = resolveDb(db)
  return d
    .select()
    .from(workflowVersions)
    .where(eq(workflowVersions.id, id))
    .get() as WorkflowVersionRecord | undefined
}

export function getWorkflowVersions(workflowId: string, db?: DbClient): WorkflowVersionRecord[] {
  const d = resolveDb(db)
  return d
    .select()
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, workflowId))
    .orderBy(desc(workflowVersions.version))
    .all() as WorkflowVersionRecord[]
}

export function getWorkflowWithCurrentVersion(
  workflowId: string,
  db?: DbClient,
): { workflow: WorkflowRecord; version: WorkflowVersionRecord | null } | undefined {
  const wf = getWorkflow(workflowId, db)
  if (!wf) return undefined

  let ver: WorkflowVersionRecord | null = null
  if (wf.currentVersionId) {
    ver = getWorkflowVersion(wf.currentVersionId, db) ?? null
  }
  return { workflow: wf, version: ver }
}

export function parseWorkflowDsl(version: WorkflowVersionRecord): Workflow {
  return JSON.parse(version.workflowDsl) as Workflow
}
