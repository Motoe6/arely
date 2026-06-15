import { describe, it, expect, vi, beforeEach } from "vitest"
import { TemplateEvolutionService, TemplateEvolutionError } from "@arelyos/engine/evolution/template-evolution-service.js"
import { TemplateRegistry } from "@arelyos/engine/templates/template-registry.js"
import type { Template } from "@arelyos/engine/templates/template-types.js"

vi.mock("@arelyos/persistence", async () => {
  const actual = await vi.importActual("@arelyos/persistence")
  return {
    ...actual,
    getProposal: vi.fn(),
    updateProposalStatus: vi.fn(),
    createTemplateVersion: vi.fn(),
    createAuditRecord: vi.fn(),
  }
})

import { getProposal, updateProposalStatus, createTemplateVersion, createAuditRecord } from "@arelyos/persistence"

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    metadata: {
      id: "tpl-evo",
      name: "Evolution Test",
      description: "Test template for evolution",
      category: "test",
      tags: [],
      templateVersion: "1.0.0",
      author: "Test",
      parameters: [
        { name: "interval", label: "Interval", type: "number", default: 60, required: false },
        { name: "timeout", label: "Timeout", type: "number", default: 1000, required: false },
        { name: "enabled", label: "Enabled", type: "boolean", default: false, required: false },
        { name: "label", label: "Label", type: "string", default: "old-value", required: false },
      ],
      requires: [],
      source: "builtin",
    },
    workflowDsl: "name: test-workflow\nsteps: []",
    workflowObj: { name: "test-workflow", steps: [] },
    ...overrides,
  }
}

describe("TemplateEvolutionService", () => {
  let registry: TemplateRegistry

  beforeEach(() => {
    vi.clearAllMocks()
    registry = new TemplateRegistry()
    registry.registerInline(makeTemplate())
  })

  it("applies an approved proposal and mutates the template", () => {
    vi.mocked(getProposal).mockReturnValue({
      id: "prop-1",
      templateId: "tpl-evo",
      type: "parameter_change",
      parameter: "interval",
      currentValue: "60",
      suggestedValue: "300",
      confidence: 0.84,
      evidence: { executions: 34, successRate: 0.91 },
      status: "approved",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    })

    const svc = new TemplateEvolutionService(registry)
    const result = svc.applyProposal("prop-1")

    expect(result.templateId).toBe("tpl-evo")
    expect(result.oldVersion).toBe("1.0.0")
    expect(result.newVersion).toBe("1.1.0")
    expect(result.proposalId).toBe("prop-1")
    expect(result.parameter).toBe("interval")
    expect(result.oldValue).toBe(60)
    expect(result.newValue).toBe(300)

    const updated = registry.get("tpl-evo")
    expect(updated).not.toBeNull()
    expect(updated!.metadata.templateVersion).toBe("1.1.0")
    const intervalParam = updated!.metadata.parameters.find((p) => p.name === "interval")
    expect(intervalParam!.default).toBe(300)

    expect(updateProposalStatus).toHaveBeenCalledWith("prop-1", "applied", undefined)
    expect(createTemplateVersion).toHaveBeenCalledWith(expect.objectContaining({
      templateId: "tpl-evo",
      version: "1.1.0",
      source: "evolution",
      proposalId: "prop-1",
    }), undefined)
    expect(createAuditRecord).toHaveBeenCalledWith(expect.objectContaining({
      templateId: "tpl-evo",
      templateVersion: "1.1.0",
      proposalId: "prop-1",
      proposalTitle: "interval: 300",
      parameter: "interval",
      evidenceSnapshot: {
        executions: 34,
        successRate: 0.91,
        confidence: 0.84,
        score: 0.84,
      },
    }), undefined)
  })

  it("converts string values to correct parameter types", () => {
    vi.mocked(getProposal).mockReturnValue({
      id: "prop-2",
      templateId: "tpl-evo",
      type: "parameter_change",
      parameter: "enabled",
      currentValue: "false",
      suggestedValue: "true",
      confidence: 0.9,
      evidence: { executions: 20, successRate: 1.0 },
      status: "approved",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    })

    const svc = new TemplateEvolutionService(registry)
    const result = svc.applyProposal("prop-2")

    expect(result.parameter).toBe("enabled")
    expect(result.oldValue).toBe(false)
    expect(result.newValue).toBe(true)

    const updated = registry.get("tpl-evo")
    const param = updated!.metadata.parameters.find((p) => p.name === "enabled")
    expect(param!.default).toBe(true)
  })

  it("throws if proposal is not approved", () => {
    vi.mocked(getProposal).mockReturnValue({
      id: "prop-3",
      templateId: "tpl-evo",
      type: "parameter_change",
      parameter: "interval",
      suggestedValue: "300",
      confidence: 0.84,
      evidence: { executions: 34, successRate: 0.91 },
      status: "draft",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      currentValue: null,
    })

    const svc = new TemplateEvolutionService(registry)
    expect(() => svc.applyProposal("prop-3")).toThrow(TemplateEvolutionError)
    expect(() => svc.applyProposal("prop-3")).toThrow(/status is "draft"/)
  })

  it("throws if proposal type is not parameter_change", () => {
    vi.mocked(getProposal).mockReturnValue({
      id: "prop-4",
      templateId: "tpl-evo",
      type: "parameter_removal",
      parameter: "interval",
      suggestedValue: null,
      confidence: 0.84,
      evidence: { executions: 34, successRate: 0.91 },
      status: "approved",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      currentValue: null,
    })

    const svc = new TemplateEvolutionService(registry)
    expect(() => svc.applyProposal("prop-4")).toThrow(TemplateEvolutionError)
    expect(() => svc.applyProposal("prop-4")).toThrow(/type "parameter_removal"/)
  })

  it("throws if template not found in registry", () => {
    vi.mocked(getProposal).mockReturnValue({
      id: "prop-5",
      templateId: "nonexistent",
      type: "parameter_change",
      parameter: "interval",
      suggestedValue: "300",
      confidence: 0.84,
      evidence: { executions: 34, successRate: 0.91 },
      status: "approved",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      currentValue: null,
    })

    const svc = new TemplateEvolutionService(registry)
    expect(() => svc.applyProposal("prop-5")).toThrow(TemplateEvolutionError)
    expect(() => svc.applyProposal("prop-5")).toThrow(/Template not found/)
  })

  it("throws if parameter not found in template metadata", () => {
    vi.mocked(getProposal).mockReturnValue({
      id: "prop-6",
      templateId: "tpl-evo",
      type: "parameter_change",
      parameter: "nonexistent_param",
      suggestedValue: "100",
      confidence: 0.84,
      evidence: { executions: 34, successRate: 0.91 },
      status: "approved",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      currentValue: null,
    })

    const svc = new TemplateEvolutionService(registry)
    expect(() => svc.applyProposal("prop-6")).toThrow(TemplateEvolutionError)
    expect(() => svc.applyProposal("prop-6")).toThrow(/not found in template/)
  })

  it("does not modify other parameters when evolving one", () => {
    vi.mocked(getProposal).mockReturnValue({
      id: "prop-7",
      templateId: "tpl-evo",
      type: "parameter_change",
      parameter: "interval",
      suggestedValue: "300",
      confidence: 0.84,
      evidence: { executions: 34, successRate: 0.91 },
      status: "approved",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      currentValue: null,
    })

    const svc = new TemplateEvolutionService(registry)
    svc.applyProposal("prop-7")

    const updated = registry.get("tpl-evo")
    const timeoutParam = updated!.metadata.parameters.find((p) => p.name === "timeout")
    expect(timeoutParam!.default).toBe(1000)

    const labelParam = updated!.metadata.parameters.find((p) => p.name === "label")
    expect(labelParam!.default).toBe("old-value")
  })

  it("bumps minor version correctly", () => {
    vi.mocked(getProposal).mockReturnValue({
      id: "prop-8",
      templateId: "tpl-evo",
      type: "parameter_change",
      parameter: "interval",
      suggestedValue: "300",
      confidence: 0.84,
      evidence: { executions: 34, successRate: 0.91 },
      status: "approved",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      currentValue: null,
    })

    const svc = new TemplateEvolutionService(registry)
    const result = svc.applyProposal("prop-8")
    expect(result.newVersion).toBe("1.1.0")

    const result2 = svc.applyProposal("prop-8")
    expect(result2.newVersion).toBe("1.2.0")
  })
})
