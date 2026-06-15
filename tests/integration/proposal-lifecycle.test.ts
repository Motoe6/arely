import { describe, it, expect, beforeAll } from "vitest"
import { createInMemoryDb } from "@arely/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arely/engine/persistence/migrate.js"
import {
  createProposal,
  listProposals,
  getProposal,
  updateProposalStatus,
} from "@arely/engine/persistence/proposal-store.js"
import type { ProposalRecord } from "@arely/engine/persistence/proposal-store.js"

describe("Proposal Lifecycle Integration", () => {
  let db: ReturnType<typeof createInMemoryDb>
  const createdIds: string[] = []

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

  it("creates proposals from multiple templates and tracks them", () => {
    const p1 = createProposal({
      templateId: "int-tpl-health",
      type: "parameter_change",
      parameter: "interval",
      currentValue: "60",
      suggestedValue: "300",
      confidence: 0.84,
      evidence: { executions: 34, successRate: 0.91 },
    }, db.db)
    createdIds.push(p1.id)
    expect(p1.status).toBe("draft")

    const p2 = createProposal({
      templateId: "int-tpl-health",
      type: "parameter_change",
      parameter: "timeout",
      currentValue: "1000",
      suggestedValue: "5000",
      confidence: 0.72,
      evidence: { executions: 22, successRate: 0.86 },
    }, db.db)
    createdIds.push(p2.id)
    expect(p2.status).toBe("draft")

    const p3 = createProposal({
      templateId: "int-tpl-backup",
      type: "parameter_change",
      parameter: "retries",
      suggestedValue: "3",
      confidence: 0.91,
      evidence: { executions: 50, successRate: 0.94 },
    }, db.db)
    createdIds.push(p3.id)
    expect(p3.status).toBe("draft")
  })

  it("lists proposals filtered by templateId", () => {
    const healthProposals = listProposals({ templateId: "int-tpl-health", db: db.db })
    expect(healthProposals.length).toBe(2)
    for (const p of healthProposals) {
      expect(p.templateId).toBe("int-tpl-health")
    }
  })

  it("approves a proposal changing status from draft to approved", () => {
    const targetId = createdIds[0]
    const updated = updateProposalStatus(targetId, "approved", db.db)
    expect(updated!.status).toBe("approved")
    expect(updated!.id).toBe(targetId)
  })

  it("rejects a proposal changing status from draft to rejected", () => {
    const targetId = createdIds[1]
    const updated = updateProposalStatus(targetId, "rejected", db.db)
    expect(updated!.status).toBe("rejected")
    expect(updated!.id).toBe(targetId)
  })

  it("lists proposals filtered by status", () => {
    const approved = listProposals({ status: "approved", db: db.db })
    expect(approved.length).toBe(1)
    expect(approved[0].status).toBe("approved")

    const rejected = listProposals({ status: "rejected", db: db.db })
    expect(rejected.length).toBe(1)
    expect(rejected[0].status).toBe("rejected")

    const drafts = listProposals({ status: "draft", db: db.db })
    expect(drafts.length).toBe(1)
    expect(drafts[0].status).toBe("draft")
  })

  it("retrieves a proposal by id preserving all fields", () => {
    const targetId = createdIds[0]
    const proposal = getProposal(targetId, db.db)

    expect(proposal).not.toBeNull()
    expect(proposal!.id).toBe(targetId)
    expect(proposal!.templateId).toBe("int-tpl-health")
    expect(proposal!.type).toBe("parameter_change")
    expect(proposal!.parameter).toBe("interval")
    expect(proposal!.currentValue).toBe("60")
    expect(proposal!.suggestedValue).toBe("300")
    expect(proposal!.confidence).toBeCloseTo(0.84, 5)
    expect(proposal!.evidence.executions).toBe(34)
    expect(proposal!.evidence.successRate).toBe(0.91)
    expect(proposal!.status).toBe("approved")
    expect(proposal!.createdAt).toBeTruthy()
    expect(proposal!.updatedAt).toBeTruthy()
  })

  it("does not allow approval of already rejected proposal", () => {
    const targetId = createdIds[1]
    const proposal = getProposal(targetId, db.db)
    expect(proposal!.status).toBe("rejected")
  })
})
