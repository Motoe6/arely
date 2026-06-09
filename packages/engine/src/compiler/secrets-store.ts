import { ulid } from "ulid"
import { eq } from "drizzle-orm"
import { getDb } from "../persistence/database.js"
import { secrets } from "../persistence/schema.js"
import { encrypt, decrypt } from "./secrets-crypto.js"

type DbClient = any

function resolveDb(db?: DbClient): DbClient {
  return db ?? getDb()
}

export interface SecretRecord {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface SecretWithValue extends SecretRecord {
  value: string
}

export function createSecret(name: string, value: string, db?: DbClient): SecretRecord {
  const d = resolveDb(db)
  const id = ulid()
  const now = new Date().toISOString()
  const encrypted = encrypt(value)
  d.insert(secrets).values({
    id,
    name,
    valueEncrypted: encrypted,
    createdAt: now,
    updatedAt: now,
  }).run()
  return { id, name, createdAt: now, updatedAt: now }
}

export function getSecret(id: string, db?: DbClient): SecretWithValue | undefined {
  const d = resolveDb(db)
  const row = d.select().from(secrets).where(eq(secrets.id, id)).get() as Record<string, unknown> | undefined
  if (!row) return undefined
  return {
    id: row.id as string,
    name: row.name as string,
    value: decrypt(row.valueEncrypted as string),
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  }
}

export function getSecretByName(name: string, db?: DbClient): SecretWithValue | undefined {
  const d = resolveDb(db)
  const row = d.select().from(secrets).where(eq(secrets.name, name)).get() as Record<string, unknown> | undefined
  if (!row) return undefined
  return {
    id: row.id as string,
    name: row.name as string,
    value: decrypt(row.valueEncrypted as string),
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  }
}

export function listSecrets(db?: DbClient): SecretRecord[] {
  const d = resolveDb(db)
  const rows = d.select().from(secrets).orderBy(secrets.name).all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  }))
}

export function updateSecret(id: string, value: string, db?: DbClient): void {
  const d = resolveDb(db)
  const now = new Date().toISOString()
  const encrypted = encrypt(value)
  d.update(secrets).set({ valueEncrypted: encrypted, updatedAt: now }).where(eq(secrets.id, id)).run()
}

export function deleteSecret(id: string, db?: DbClient): void {
  const d = resolveDb(db)
  d.delete(secrets).where(eq(secrets.id, id)).run()
}

export function loadSecretsMap(db?: DbClient): Record<string, string> {
  const d = resolveDb(db)
  const rows = d.select().from(secrets).all() as Record<string, unknown>[]
  const map: Record<string, string> = {}
  for (const row of rows) {
    try {
      map[row.name as string] = decrypt(row.valueEncrypted as string)
    } catch {
      // skip secrets that fail to decrypt
    }
  }
  return map
}
