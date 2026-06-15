import { describe, it, expect, beforeAll } from "vitest"
import { createInMemoryDb } from "@arely/engine/persistence/database.js"
import { CREATE_TABLES, MIGRATIONS, CREATE_INDEXES } from "@arely/engine/persistence/migrate.js"
import {
  createAuditRecord,
  getAuditByTemplate,
  getAuditByProposal,
  listAudit,
} from "@arely/engine/persistence/evolution-audit-store.js"
import type { EvidenceSnapshot } from "@arely/engine/evolution/evolution-types.js"

describe("EvolutionAuditStore", () => {
  let db: ReturnType<typeof createInMemoryDb>

  beforeAll(() => {
    db = createInMemoryDb()
    for (const stmt of CREATE_TABLES) {
      db.sqlite.exec(stmt)
    }
    for (const stmt of MIGRATIONS) {
      try { db.sqlite.exec(stmt) } catch { }
    }
    for (const idx of CREATE_INDEXES) {
      try { db.sqlite.exec(idx) } catch { }
    }
  })

  const snapshot: EvidenceSnapshot = {
    executions: 30,
    successRate: 0.9,
    confidence: 0.85,
    score: 0.85,
  }

  it("creates an audit record with all fields", () => {
    const record = createAuditRecord({
      templateId: "tpl-health",
      templateVersion: "1.1.0",
      proposalId: "prop-001",
      proposalTitle: "interval: 300",
      parameter: "interval",
      oldValue: "60",
      newValue: "300",
      approvedBy: null,
      evidenceSnapshot: snapshot,
    }, db.db)

    expect(record.id).toBeTruthy()
    expect(record.templateId).toBe("tpl-health")
    expect(record.templateVersion).toBe("1.1.0")
    expect(record.proposalId).toBe("prop-001")
    expect(record.proposalTitle).toBe("interval: 300")
    expect(record.parameter).toBe("interval")
    expect(record.oldValue).toBe("60")
    expect(record.newValue).toBe("300")
    expect(record.approvedBy).toBeNull()
    expect(record.evidenceSnapshot).toEqual(snapshot)
    expect(record.createdAt).toBeTruthy()
  })

  it("creates audit records for multiple templates", () => {
    const r1 = createAuditRecord({
      templateId: "tpl-health",
      templateVersion: "1.1.0",
      proposalId: "prop-002",
      parameter: "timeout",
      oldValue: "1000",
      newValue: "5000",
      evidenceSnapshot: { executions: 22, successRate: 0.86, confidence: 0.72, score: 0.72 },
    }, db.db)

    const r2 = createAuditRecord({
      templateId: "tpl-backup",
      templateVersion: "1.2.0",
      proposalId: "prop-003",
      proposalTitle: "retries: 5",
      parameter: "retries",
      oldValue: "3",
      newValue: "5",
      evidenceSnapshot: { executions: 50, successRate: 0.94, confidence: 0.91, score: 0.91 },
    }, db.db)

    expect(r1.templateId).toBe("tpl-health")
    expect(r2.templateId).toBe("tpl-backup")
  })

  it("retrieves audit records by template id in reverse chronological order", () => {
    const records = getAuditByTemplate("tpl-health", undefined, db.db)
    expect(records.length).toBeGreaterThanOrEqual(2)

    for (const r of records) {
      expect(r.templateId).toBe("tpl-health")
    }

    for (let i = 1; i < records.length; i++) {
      expect(records[i - 1].createdAt >= records[i].createdAt).toBe(true)
    }
  })

  it("retrieves audit records by proposal id", () => {
    const record = getAuditByProposal("prop-001", db.db)
    expect(record).not.toBeNull()
    expect(record!.proposalId).toBe("prop-001")
    expect(record!.parameter).toBe("interval")
    expect(record!.evidenceSnapshot.executions).toBe(30)
  })

  it("returns null for nonexistent proposal audit", () => {
    const record = getAuditByProposal("nonexistent", db.db)
    expect(record).toBeNull()
  })

  it("lists all audit records with pagination", () => {
    const all = listAudit(undefined, db.db)
    expect(all.length).toBeGreaterThanOrEqual(3)

    const limited = listAudit({ limit: 2 }, db.db)
    expect(limited.length).toBe(2)

    const offset = listAudit({ limit: 2, offset: 2 }, db.db)
    expect(offset.length).toBeGreaterThanOrEqual(1)
  })

  it("filters list by templateId", () => {
    const records = listAudit({ templateId: "tpl-backup" }, db.db)
    expect(records.length).toBe(1)
    expect(records[0].templateId).toBe("tpl-backup")
  })

  it("handles null proposalTitle gracefully", () => {
    const record = createAuditRecord({
      templateId: "tpl-null-title",
      templateVersion: "1.0.0",
      proposalId: "prop-no-title",
      parameter: "enabled",
      oldValue: "false",
      newValue: "true",
      evidenceSnapshot: { executions: 10, successRate: 1.0, confidence: 0.95, score: 0.95 },
    }, db.db)

    expect(record.proposalTitle).toBeNull()

    const fetched = getAuditByProposal("prop-no-title", db.db)
    expect(fetched!.proposalTitle).toBeNull()
  })
})
