import { ulid } from "ulid"
import { eq, and } from "drizzle-orm"
import { getDb } from "../persistence/database.js"
import { installedNodes } from "../persistence/schema.js"

type DbClient = any

function resolveDb(db?: DbClient): DbClient {
  return db ?? getDb()
}

export interface InstalledNodeRecord {
  id: string
  name: string
  version: string
  nodeType: string
  category: string | null
  description: string | null
  author: string | null
  entryPath: string
  manifestVersion: number
  installedAt: string
  enabled: number
}

export function createInstalledNode(
  data: Omit<InstalledNodeRecord, "id" | "installedAt">,
  db?: DbClient,
): InstalledNodeRecord {
  const d = resolveDb(db)
  const id = ulid()
  const now = new Date().toISOString()
  d.insert(installedNodes).values({
    id,
    name: data.name,
    version: data.version,
    nodeType: data.nodeType,
    category: data.category ?? null,
    description: data.description ?? null,
    author: data.author ?? null,
    entryPath: data.entryPath,
    manifestVersion: data.manifestVersion,
    installedAt: now,
    enabled: data.enabled,
  }).run()
  return {
    id,
    name: data.name,
    version: data.version,
    nodeType: data.nodeType,
    category: data.category ?? null,
    description: data.description ?? null,
    author: data.author ?? null,
    entryPath: data.entryPath,
    manifestVersion: data.manifestVersion,
    installedAt: now,
    enabled: data.enabled,
  }
}

export function getInstalledNode(id: string, db?: DbClient): InstalledNodeRecord | undefined {
  const d = resolveDb(db)
  const row = d.select().from(installedNodes).where(eq(installedNodes.id, id)).get() as Record<string, unknown> | undefined
  if (!row) return undefined
  return mapRow(row)
}

export function getInstalledNodeByType(nodeType: string, db?: DbClient): InstalledNodeRecord | undefined {
  const d = resolveDb(db)
  const row = d.select().from(installedNodes).where(eq(installedNodes.nodeType, nodeType)).get() as Record<string, unknown> | undefined
  if (!row) return undefined
  return mapRow(row)
}

export function getInstalledNodeByNameVersion(name: string, version: string, db?: DbClient): InstalledNodeRecord | undefined {
  const d = resolveDb(db)
  const row = d.select().from(installedNodes).where(
    and(eq(installedNodes.name, name), eq(installedNodes.version, version)),
  ).get() as Record<string, unknown> | undefined
  if (!row) return undefined
  return mapRow(row)
}

export function listInstalledNodes(enabledOnly?: boolean, db?: DbClient): InstalledNodeRecord[] {
  const d = resolveDb(db)
  let query = d.select().from(installedNodes).orderBy(installedNodes.name) as { all: () => Record<string, unknown>[] }
  if (enabledOnly) {
    query = d.select().from(installedNodes).where(eq(installedNodes.enabled, 1)).orderBy(installedNodes.name) as typeof query
  }
  const rows = query.all() as Record<string, unknown>[]
  return rows.map(mapRow)
}

export function updateInstalledNode(id: string, updates: Partial<InstalledNodeRecord>, db?: DbClient): void {
  const d = resolveDb(db)
  const setFields: Record<string, unknown> = {}
  if (updates.name !== undefined) setFields.name = updates.name
  if (updates.version !== undefined) setFields.version = updates.version
  if (updates.nodeType !== undefined) setFields.nodeType = updates.nodeType
  if (updates.category !== undefined) setFields.category = updates.category
  if (updates.description !== undefined) setFields.description = updates.description
  if (updates.author !== undefined) setFields.author = updates.author
  if (updates.entryPath !== undefined) setFields.entryPath = updates.entryPath
  if (updates.manifestVersion !== undefined) setFields.manifestVersion = updates.manifestVersion
  if (updates.enabled !== undefined) setFields.enabled = updates.enabled
  if (Object.keys(setFields).length === 0) return
  d.update(installedNodes).set(setFields).where(eq(installedNodes.id, id)).run()
}

export function deleteInstalledNode(id: string, db?: DbClient): void {
  const d = resolveDb(db)
  d.delete(installedNodes).where(eq(installedNodes.id, id)).run()
}

function mapRow(row: Record<string, unknown>): InstalledNodeRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    version: row.version as string,
    nodeType: row.nodeType as string,
    category: (row.category as string) ?? null,
    description: (row.description as string) ?? null,
    author: (row.author as string) ?? null,
    entryPath: row.entryPath as string,
    manifestVersion: row.manifestVersion as number,
    installedAt: row.installedAt as string,
    enabled: row.enabled as number,
  }
}
