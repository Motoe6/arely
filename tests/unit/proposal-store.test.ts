import { describe, it, expect, beforeAll } from "vitest"
import { createInMemoryDb } from "@arely/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arely/engine/persistence/migrate.js"
import {
  createProposal,
  listProposals,
  getProposal,
  updateProposalStatus,
} from "@arely/engine/persistence/proposal-store.js"

describe("Proposal Store", () => {
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

  it("creates a draft proposal", () => {
    const p = createProposal({
      templateId: "tpl-A",
      type: "parameter_change",
      parameter: "interval",
      currentValue: "60",
      suggestedValue: "300",
      confidence: 0.84,
      evidence: { executions: 34, successRate: 0.91 },
    }, db.db)

    expect(p.id).toBeTruthy()
    expect(p.templateId).toBe("tpl-A")
    expect(p.type).toBe("parameter_change")
    expect(p.parameter).toBe("interval")
    expect(p.currentValue).toBe("60")
    expect(p.suggestedValue).toBe("300")
    expect(p.confidence).toBe(0.84)
    expect(p.evidence.executions).toBe(34)
    expect(p.evidence.successRate).toBe(0.91)
    expect(p.status).toBe("draft")
    expect(p.createdAt).toBeTruthy()
    expect(p.updatedAt).toBeTruthy()
  })

  it("creates proposal with null optional fields", () => {
    const p = createProposal({
      templateId: "tpl-B",
      type: "parameter_removal",
      parameter: "debug_mode",
      confidence: 0.72,
      evidence: { executions: 20, successRate: 0.85 },
    }, db.db)

    expect(p.currentValue).toBeNull()
    expect(p.suggestedValue).toBeNull()
    expect(p.type).toBe("parameter_removal")
  })

  it("gets proposal by id", () => {
    const p = createProposal({
      templateId: "tpl-C",
      type: "parameter_change",
      parameter: "timeout",
      suggestedValue: "5000",
      confidence: 0.9,
      evidence: { executions: 40, successRate: 0.95 },
    }, db.db)

    const found = getProposal(p.id, db.db)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(p.id)
    expect(found!.parameter).toBe("timeout")
  })

  it("returns null for nonexistent proposal", () => {
    const found = getProposal("nonexistent", db.db)
    expect(found).toBeNull()
  })

  it("updates proposal status to approved", () => {
    const p = createProposal({
      templateId: "tpl-D",
      type: "parameter_change",
      parameter: "retries",
      suggestedValue: "3",
      confidence: 0.88,
      evidence: { executions: 25, successRate: 0.92 },
    }, db.db)

    const updated = updateProposalStatus(p.id, "approved", db.db)
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe("approved")
    expect(updated!.updatedAt).toBeTruthy()
  })

  it("updates proposal status to rejected", () => {
    const p = createProposal({
      templateId: "tpl-E",
      type: "parameter_change",
      parameter: "batch_size",
      suggestedValue: "100",
      confidence: 0.65,
      evidence: { executions: 22, successRate: 0.78 },
    }, db.db)

    const updated = updateProposalStatus(p.id, "rejected", db.db)
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe("rejected")
  })

  it("lists all proposals", () => {
    const all = listProposals({ db: db.db })
    expect(all.length).toBeGreaterThanOrEqual(5)
  })

  it("filters proposals by status", () => {
    const drafts = listProposals({ status: "draft", db: db.db })
    for (const p of drafts) {
      expect(p.status).toBe("draft")
    }
  })

  it("filters proposals by templateId", () => {
    const results = listProposals({ templateId: "tpl-A", db: db.db })
    expect(results.length).toBeGreaterThanOrEqual(1)
    for (const p of results) {
      expect(p.templateId).toBe("tpl-A")
    }
  })

  it("filters by both status and templateId", () => {
    const results = listProposals({ status: "draft", templateId: "tpl-A", db: db.db })
    for (const p of results) {
      expect(p.status).toBe("draft")
      expect(p.templateId).toBe("tpl-A")
    }
  })
})
