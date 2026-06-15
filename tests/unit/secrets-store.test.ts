import { describe, it, expect, beforeAll } from "vitest"
import { createInMemoryDb } from "@arelyos/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arelyos/engine/persistence/migrate.js"
import { resetKey } from "@arelyos/engine/compiler/secrets-crypto.js"
import {
  createSecret,
  getSecret,
  listSecrets,
  updateSecret,
  deleteSecret,
  getSecretByName,
  loadSecretsMap,
} from "@arelyos/engine/compiler/secrets-store.js"

describe("Secrets Store", () => {
  let db: ReturnType<typeof createInMemoryDb>

  beforeAll(() => {
    resetKey()
    process.env.FLOW_SECRET_KEY = "test-secret-key-for-store-tests"
    resetKey()

    db = createInMemoryDb()
    for (const stmt of CREATE_TABLES) {
      db.sqlite.exec(stmt)
    }
    for (const stmt of MIGRATIONS) {
      try { db.sqlite.exec(stmt) } catch { /* may already exist */ }
    }
    for (const idx of CREATE_INDEXES) {
      try { db.sqlite.exec(idx) } catch { /* column may not exist */ }
    }
  })

  it("creates and retrieves a secret", () => {
    const record = createSecret("api_key", "sk-12345", db.db)
    expect(record.id).toBeTruthy()
    expect(record.name).toBe("api_key")

    const retrieved = getSecret(record.id, db.db)!
    expect(retrieved).toBeDefined()
    expect(retrieved.name).toBe("api_key")
    expect(retrieved.value).toBe("sk-12345")
  })

  it("retrieves secret by name", () => {
    createSecret("slack_token", "xoxb-test-token", db.db)
    const retrieved = getSecretByName("slack_token", db.db)!
    expect(retrieved).toBeDefined()
    expect(retrieved.value).toBe("xoxb-test-token")
  })

  it("lists secrets without values", () => {
    const list = listSecrets(db.db)
    expect(list.length).toBeGreaterThanOrEqual(2)
    for (const s of list) {
      expect((s as Record<string, unknown>).value).toBeUndefined()
    }
  })

  it("updates a secret value", () => {
    const record = createSecret("to_update", "old-value", db.db)
    updateSecret(record.id, "new-value", db.db)
    const retrieved = getSecret(record.id, db.db)!
    expect(retrieved.value).toBe("new-value")
  })

  it("deletes a secret", () => {
    const record = createSecret("to_delete", "gone", db.db)
    deleteSecret(record.id, db.db)
    const retrieved = getSecret(record.id, db.db)
    expect(retrieved).toBeUndefined()
  })

  it("returns undefined for non-existent secret", () => {
    const retrieved = getSecret("nonexistent", db.db)
    expect(retrieved).toBeUndefined()
  })

  it("loadSecretsMap returns all secrets as name->value map", () => {
    const map = loadSecretsMap(db.db)
    expect(map.api_key).toBe("sk-12345")
    expect(map.slack_token).toBe("xoxb-test-token")
    expect(map.to_update).toBe("new-value")
  })
})
