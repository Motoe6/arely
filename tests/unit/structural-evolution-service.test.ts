import { describe, it, expect, beforeEach } from "vitest"
import { TemplateRegistry } from "@arelyos/engine/templates/template-registry.js"
import { StructuralEvolutionService, StructuralEvolutionError } from "@arelyos/engine/structural/structural-evolution-service.js"
import { createProposal, updateProposalStatus, getProposal } from "@arelyos/engine/persistence/proposal-store.js"
import { createInMemoryDb } from "@arelyos/engine/persistence/database.js"
import { CREATE_TABLES, MIGRATIONS, CREATE_INDEXES } from "@arelyos/engine/persistence/migrate.js"

function makeDb() {
  const db = createInMemoryDb()
  for (const stmt of CREATE_TABLES) db.sqlite.exec(stmt)
  for (const stmt of MIGRATIONS) try { db.sqlite.exec(stmt) } catch { }
  for (const idx of CREATE_INDEXES) try { db.sqlite.exec(idx) } catch { }
  return db
}

function makeTemplate(id: string, steps: Record<string, unknown>[], override?: Partial<Record<string, unknown>>) {
  return {
    metadata: {
      id, name: `tpl-${id}`, description: "", category: "default", tags: [],
      templateVersion: "1.0.0", author: "Test", parameters: [], requires: [], source: "builtin" as const,
    },
    workflowDsl: "",
    workflowObj: { name: "test", steps, trigger: { type: "manual" }, ...override },
  }
}

function makeStructuralProposal(db: any, templateId: string, kind: string, status = "approved") {
  const p = createProposal({
    templateId,
    type: "structural",
    parameter: kind,
    currentValue: kind,
    suggestedValue: `Proposal for ${kind}`,
    confidence: 0.85,
    evidence: { executions: 25, successRate: 0.9 },
  }, db.db)
  if (status === "approved") {
    updateProposalStatus(p.id, "approved", db.db)
  } else if (status !== "draft") {
    updateProposalStatus(p.id, status as any, db.db)
  }
  return getProposal(p.id, db.db)!
}

describe("StructuralEvolutionService", () => {
  let registry: TemplateRegistry
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    db = makeDb()
    registry = new TemplateRegistry()
  })

  describe("applyProposal - validation", () => {
    it("throws when proposal not found", () => {
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      expect(() => svc.applyProposal("nonexistent")).toThrow(StructuralEvolutionError)
      expect(() => svc.applyProposal("nonexistent")).toThrow("Proposal not found")
    })

    it("throws when proposal is not approved", () => {
      registry.registerInline(makeTemplate("tpl-1", [{ id: "s1", type: "http" }]))
      const proposal = makeStructuralProposal(db, "tpl-1", "add_retry", "draft")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      expect(() => svc.applyProposal(proposal.id)).toThrow("status is \"draft\"")
    })

    it("throws when proposal is rejected", () => {
      registry.registerInline(makeTemplate("tpl-1", [{ id: "s1", type: "http" }]))
      const proposal = makeStructuralProposal(db, "tpl-1", "add_retry", "rejected")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      expect(() => svc.applyProposal(proposal.id)).toThrow("status is \"rejected\"")
    })

    it("throws when proposal type is not structural", () => {
      registry.registerInline(makeTemplate("tpl-1", [{ id: "s1", type: "http" }]))
      const p = createProposal({
        templateId: "tpl-1",
        type: "parameter_change",
        parameter: "url",
        currentValue: "old",
        suggestedValue: "new",
        confidence: 0.5,
        evidence: { executions: 10, successRate: 0.5 },
      }, db.db)
      const approved = updateProposalStatus(p.id, "approved", db.db)!
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      expect(() => svc.applyProposal(approved.id)).toThrow("type \"parameter_change\" is not supported")
    })

    it("throws when template not found in registry", () => {
      const proposal = makeStructuralProposal(db, "tpl-nonexistent", "add_retry")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      expect(() => svc.applyProposal(proposal.id)).toThrow("Template not found in registry")
    })
  })

  describe("applyProposal - add_retry", () => {
    it("adds retry config to steps without retry", () => {
      registry.registerInline(makeTemplate("tpl-1", [
        { id: "s1", type: "http" },
        { id: "s2", type: "transform" },
      ]))
      const proposal = makeStructuralProposal(db, "tpl-1", "add_retry")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      const result = svc.applyProposal(proposal.id)

      expect(result.kind).toBe("add_retry")
      expect(result.changes.length).toBe(2)
      expect(result.changes[0]).toContain("s1")
      expect(result.changes[1]).toContain("s2")
      expect(result.oldVersion).toBe("1.0.0")
      expect(result.newVersion).toBe("1.1.0")

      const updated = registry.get("tpl-1")!
      const steps = updated.workflowObj.steps as Array<Record<string, unknown>>
      expect((steps[0].onFailure as any).retry.maxAttempts).toBe(3)
      expect((steps[1].onFailure as any).retry.maxAttempts).toBe(3)
    })

    it("does not modify steps that already have retry", () => {
      registry.registerInline(makeTemplate("tpl-1", [
        { id: "s1", type: "http", onFailure: { retry: { maxAttempts: 5 } } },
        { id: "s2", type: "transform" },
      ]))
      const proposal = makeStructuralProposal(db, "tpl-1", "add_retry")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      const result = svc.applyProposal(proposal.id)

      expect(result.changes.length).toBe(1)
      expect(result.changes[0]).toContain("s2")

      const updated = registry.get("tpl-1")!
      const steps = updated.workflowObj.steps as Array<Record<string, unknown>>
      expect((steps[0].onFailure as any).retry.maxAttempts).toBe(5)
    })

    it("updates metadata templateVersion", () => {
      const tpl = makeTemplate("tpl-1", [{ id: "s1", type: "http" }])
      tpl.metadata.templateVersion = "2.3.0"
      registry.registerInline(tpl)
      const proposal = makeStructuralProposal(db, "tpl-1", "add_retry")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      const result = svc.applyProposal(proposal.id)
      expect(result.oldVersion).toBe("2.3.0")
      expect(result.newVersion).toBe("2.4.0")
      expect(registry.get("tpl-1")!.metadata.templateVersion).toBe("2.4.0")
    })
  })

  describe("applyProposal - add_error_handling", () => {
    it("adds error handler step and fallback to first step", () => {
      registry.registerInline(makeTemplate("tpl-1", [{ id: "s1", type: "http" }]))
      const proposal = makeStructuralProposal(db, "tpl-1", "add_error_handling")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      const result = svc.applyProposal(proposal.id)

      expect(result.kind).toBe("add_error_handling")
      expect(result.changes.length).toBe(2)

      const updated = registry.get("tpl-1")!
      const steps = updated.workflowObj.steps as Array<Record<string, unknown>>
      expect(steps.length).toBe(2)
      expect(steps[0].onFailure as any).toEqual({ fallback: "error_handler" })
      expect(steps[1].id).toBe("error_handler")
      expect(steps[1].type).toBe("log")
    })

    it("skips adding fallback if first step already has one", () => {
      registry.registerInline(makeTemplate("tpl-1", [
        { id: "s1", type: "http", onFailure: { fallback: "s2" } },
        { id: "s2", type: "log" },
      ]))
      const proposal = makeStructuralProposal(db, "tpl-1", "add_error_handling")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      const result = svc.applyProposal(proposal.id)

      expect(result.changes.length).toBe(1)
      expect(result.changes[0]).toContain("error_handler")

      const updated = registry.get("tpl-1")!
      const steps = updated.workflowObj.steps as Array<Record<string, unknown>>
      expect(steps.length).toBe(3)
      expect((steps[0].onFailure as any).fallback).toBe("s2")
    })
  })

  describe("applyProposal - split_into_chain", () => {
    it("splits single-step workflow into two-step chain", () => {
      registry.registerInline(makeTemplate("tpl-1", [{ id: "s1", type: "http" }]))
      const proposal = makeStructuralProposal(db, "tpl-1", "split_into_chain")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      const result = svc.applyProposal(proposal.id)

      expect(result.kind).toBe("split_into_chain")
      expect(result.changes.length).toBe(1)

      const updated = registry.get("tpl-1")!
      const steps = updated.workflowObj.steps as Array<Record<string, unknown>>
      expect(steps.length).toBe(2)
      expect(steps[0].id).toBe("s1")
      expect(steps[0].next).toBe("s1_process")
      expect(steps[1].id).toBe("s1_process")
      expect(steps[1].type).toBe("transform")
    })

    it("does not split multi-step workflow", () => {
      registry.registerInline(makeTemplate("tpl-1", [
        { id: "s1", type: "http", next: "s2" },
        { id: "s2", type: "llm" },
      ]))
      const proposal = makeStructuralProposal(db, "tpl-1", "split_into_chain")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      const result = svc.applyProposal(proposal.id)

      expect(result.changes.length).toBe(0)

      const updated = registry.get("tpl-1")!
      const steps = updated.workflowObj.steps as Array<Record<string, unknown>>
      expect(steps.length).toBe(2)
    })
  })

  describe("applyProposal - parameterize_value", () => {
    it("adds parameter to metadata and modifies first step input", () => {
      registry.registerInline(makeTemplate("tpl-1", [{ id: "s1", type: "http" }]))
      const proposal = makeStructuralProposal(db, "tpl-1", "parameterize_value")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      const result = svc.applyProposal(proposal.id)

      expect(result.kind).toBe("parameterize_value")
      expect(result.changes.length).toBe(2)

      const updated = registry.get("tpl-1")!
      expect(updated.metadata.parameters.length).toBe(1)
      expect(updated.metadata.parameters[0].name).toBe("target_input")

      const steps = updated.workflowObj.steps as Array<Record<string, unknown>>
      expect((steps[0].input as any).target_input).toBe("{{param:target_input}}")
    })

    it("skips if template already has parameters", () => {
      const tpl = makeTemplate("tpl-1", [{ id: "s1", type: "http" }])
      tpl.metadata.parameters = [{ name: "url", label: "URL", type: "string" }]
      registry.registerInline(tpl)
      const proposal = makeStructuralProposal(db, "tpl-1", "parameterize_value")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      const result = svc.applyProposal(proposal.id)

      expect(result.changes.length).toBe(0)
      expect(registry.get("tpl-1")!.metadata.parameters.length).toBe(1)
      expect(registry.get("tpl-1")!.metadata.parameters[0].name).toBe("url")
    })
  })

  describe("applyProposal - unknown kind", () => {
    it("throws for unknown structural kind", () => {
      registry.registerInline(makeTemplate("tpl-1", [{ id: "s1", type: "http" }]))
      const proposal = makeStructuralProposal(db, "tpl-1", "unknown_kind")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      expect(() => svc.applyProposal(proposal.id)).toThrow("Unknown structural evolution kind")
    })
  })

  describe("applyProposal - version and audit", () => {
    it("bumps version and updates registry", () => {
      registry.registerInline(makeTemplate("tpl-1", [{ id: "s1", type: "http" }]))
      const proposal = makeStructuralProposal(db, "tpl-1", "add_retry")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      const result = svc.applyProposal(proposal.id)

      expect(result.oldVersion).toBe("1.0.0")
      expect(result.newVersion).toBe("1.1.0")
      expect(registry.get("tpl-1")!.metadata.templateVersion).toBe("1.1.0")
    })

    it("sets proposal status to applied", () => {
      registry.registerInline(makeTemplate("tpl-1", [{ id: "s1", type: "http" }]))
      const proposal = makeStructuralProposal(db, "tpl-1", "add_retry")
      const svc = new StructuralEvolutionService(registry, { db: db.db })
      svc.applyProposal(proposal.id)

      const after = getProposal(proposal.id, db.db)!
      expect(after.status).toBe("applied")
    })
  })
})
