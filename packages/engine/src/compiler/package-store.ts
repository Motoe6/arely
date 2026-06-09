import { ulid } from "ulid"
import { eq } from "drizzle-orm"
import { getDb } from "../persistence/database.js"
import { installedPackages } from "../persistence/schema.js"

type DbClient = any

function resolveDb(db?: DbClient): DbClient {
  return db ?? getDb()
}

export interface InstalledPackageRecord {
  id: string
  name: string
  version: string
  description: string | null
  author: string | null
  packageDir: string
  manifestVersion: number
  installedAt: string
  enabled: number
}

export function createInstalledPackage(
  data: Omit<InstalledPackageRecord, "id" | "installedAt">,
  db?: DbClient,
): InstalledPackageRecord {
  const d = resolveDb(db)
  const id = ulid()
  const now = new Date().toISOString()
  d.insert(installedPackages).values({
    id,
    name: data.name,
    version: data.version,
    description: data.description ?? null,
    author: data.author ?? null,
    packageDir: data.packageDir,
    manifestVersion: data.manifestVersion,
    installedAt: now,
    enabled: data.enabled,
  }).run()
  return {
    id,
    name: data.name,
    version: data.version,
    description: data.description ?? null,
    author: data.author ?? null,
    packageDir: data.packageDir,
    manifestVersion: data.manifestVersion,
    installedAt: now,
    enabled: data.enabled,
  }
}

export function getInstalledPackage(id: string, db?: DbClient): InstalledPackageRecord | undefined {
  const d = resolveDb(db)
  const row = d.select().from(installedPackages).where(eq(installedPackages.id, id)).get() as Record<string, unknown> | undefined
  if (!row) return undefined
  return mapRow(row)
}

export function getInstalledPackageByNameVersion(name: string, version: string, db?: DbClient): InstalledPackageRecord | undefined {
  const d = resolveDb(db)
  const row = d.select().from(installedPackages).where(
    eq(installedPackages.name, name) as any,
  ).all() as Record<string, unknown>[]
  const match = row.find((r) => r.version === version)
  if (!match) return undefined
  return mapRow(match)
}

export function listInstalledPackages(enabledOnly?: boolean, db?: DbClient): InstalledPackageRecord[] {
  const d = resolveDb(db)
  let query: any
  if (enabledOnly) {
    query = d.select().from(installedPackages).where(eq(installedPackages.enabled, 1)).orderBy(installedPackages.name)
  } else {
    query = d.select().from(installedPackages).orderBy(installedPackages.name)
  }
  return (query.all() as Record<string, unknown>[]).map(mapRow)
}

export function deleteInstalledPackage(id: string, db?: DbClient): void {
  const d = resolveDb(db)
  d.delete(installedPackages).where(eq(installedPackages.id, id)).run()
}

function mapRow(row: Record<string, unknown>): InstalledPackageRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    version: row.version as string,
    description: (row.description as string) ?? null,
    author: (row.author as string) ?? null,
    packageDir: row.packageDir as string,
    manifestVersion: row.manifestVersion as number,
    installedAt: row.installedAt as string,
    enabled: row.enabled as number,
  }
}
