import { describe, it, expect, vi, beforeEach } from "vitest"
import { StructuralEvolutionProposalService } from "@arelyos/engine/structural/structural-evolution-proposal-service.js"
import { TemplateRegistry } from "@arelyos/engine/templates/template-registry.js"
import type { Template } from "@arelyos/engine/templates/template-types.js"

vi.mock("@arelyos/persistence", async () => {
  const actual = await vi.importActual("@arelyos/persistence")
  return { ...actual, getFeedbackByTemplate: vi.fn() }
})

import { getFeedbackByTemplate } from "@arelyos/persistence"

function makeTemplate(id: string, steps: Record<string, unknown>[], triggerType = "manual", params: Array<{ name: string; label: string; type: string }> = [], name = "Test"): Template {
  return {
    metadata: {
      id,
      name,
      description: "",
      category: "default",
      tags: [],
      templateVersion: "1.0.0",
      author: "Test",
      parameters: params as any,
      requires: [],
      source: "builtin",
    },
    workflowDsl: "",
    workflowObj: { name: "test", steps, trigger: { type: triggerType } },
  }
}

describe("StructuralEvolutionProposalService", () => {
  let registry: TemplateRegistry

  beforeEach(() => {
    vi.clearAllMocks()
    registry = new TemplateRegistry()
  })

  it("returns empty when no templates registered", () => {
    const svc = new StructuralEvolutionProposalService(registry)
    const proposals = svc.getProposals()
    expect(proposals).toEqual([])
  })

  it("returns proposal for add_retry when template lacks retry and pattern has good metrics", () => {
    registry.registerInline(makeTemplate("tpl-1", [{ id: "s1", type: "http" }]))
    registry.registerInline(makeTemplate("tpl-retry", [{ id: "s1", type: "http", onFailure: { retry: { maxAttempts: 3 } } }]))

    vi.mocked(getFeedbackByTemplate).mockImplementation((tid: string) => {
      if (tid === "tpl-retry") return Array.from({ length: 25 }, (_, i) => ({
        id: `fr-${i}`, workflowId: `w${i}`, workflowVersionId: null, templateId: tid, source: "template" as const,
        success: true, durationMs: null, parameters: null, createdAt: "2024-01-01",
      }))
      return [{ id: "f1", workflowId: "w1", workflowVersionId: null, templateId: tid, source: "template", success: true, durationMs: null, parameters: null, createdAt: "2024-01-01" }]
    })

    const svc = new StructuralEvolutionProposalService(registry)
    const proposals = svc.getProposals("tpl-1")
    const retry = proposals.find((p) => p.kind === "add_retry")
    expect(retry).toBeDefined()
    expect(retry!.title).toBe("Add retry configuration")
    expect(retry!.confidence).toBeGreaterThan(0)
    expect(retry!.evidence.pattern).toBe("has_retry_config")
  })

  it("returns proposal for add_error_handling when template has no error handling", () => {
    registry.registerInline(makeTemplate("tpl-1", [{ id: "s1", type: "http" }]))
    registry.registerInline(makeTemplate("tpl-eh", [{ id: "s1", type: "http", onFailure: { fallback: "s2" } }]))

    vi.mocked(getFeedbackByTemplate).mockImplementation((tid: string) => {
      if (tid === "tpl-eh") return Array.from({ length: 25 }, (_, i) => ({
        id: `fe-${i}`, workflowId: `w${i}`, workflowVersionId: null, templateId: tid, source: "template" as const,
        success: true, durationMs: null, parameters: null, createdAt: "2024-01-01",
      }))
      return [{ id: "f1", workflowId: "w1", workflowVersionId: null, templateId: tid, source: "template", success: true, durationMs: null, parameters: null, createdAt: "2024-01-01" }]
    })

    const svc = new StructuralEvolutionProposalService(registry)
    const proposals = svc.getProposals("tpl-1")
    const eh = proposals.find((p) => p.kind === "add_error_handling")
    expect(eh).toBeDefined()
    expect(eh!.title).toBe("Add error handling")
  })

  it("returns no proposal when thresholds not met", () => {
    registry.registerInline(makeTemplate("tpl-1", [{ id: "s1", type: "http" }]))
    registry.registerInline(makeTemplate("tpl-retry", [{ id: "s1", type: "http", onFailure: { retry: { maxAttempts: 3 } } }]))

    vi.mocked(getFeedbackByTemplate).mockImplementation((tid: string) => {
      if (tid === "tpl-retry") return [{ id: "f1", workflowId: "w1", workflowVersionId: null, templateId: tid, source: "template", success: true, durationMs: null, parameters: null, createdAt: "2024-01-01" }]
      return []
    })

    const svc = new StructuralEvolutionProposalService(registry)
    // getProposals without templateId should generate proposals for all templates
    const proposals = svc.getProposals()

    // tpl-retry already has retry, so no proposal for it
    const retryProposals = proposals.filter((p) => p.kind === "add_retry")
    // tpl-1 should get an add_retry proposal if the insight passes thresholds
    // With only 1 execution, MIN_SAMPLE = 20 is NOT met, so no proposal
    expect(retryProposals.length).toBe(0)
  })

  it("returns proposal for parameterize_value when template is not parameterized", () => {
    registry.registerInline(makeTemplate("tpl-1", [{ id: "s1", type: "http" }]))
    registry.registerInline(makeTemplate("tpl-param", [{ id: "s1", type: "http" }], "manual", [
      { name: "url", label: "URL", type: "string" },
    ]))

    vi.mocked(getFeedbackByTemplate).mockImplementation((tid: string) => {
      if (tid === "tpl-param") return Array.from({ length: 25 }, (_, i) => ({
        id: `fp-${i}`, workflowId: `w${i}`, workflowVersionId: null, templateId: tid, source: "template" as const,
        success: true, durationMs: null, parameters: null, createdAt: "2024-01-01",
      }))
      return [{ id: "f1", workflowId: "w1", workflowVersionId: null, templateId: tid, source: "template", success: true, durationMs: null, parameters: null, createdAt: "2024-01-01" }]
    })

    const svc = new StructuralEvolutionProposalService(registry)
    const proposals = svc.getProposals("tpl-1")
    const param = proposals.find((p) => p.kind === "parameterize_value")
    expect(param).toBeDefined()
    expect(param!.title).toBe("Parameterize template values")
  })

  it("returns proposal for split_into_chain when single-step underperforms chains", () => {
    registry.registerInline(makeTemplate("tpl-single", [{ id: "s1", type: "http" }]))
    registry.registerInline(makeTemplate("tpl-chain", [
      { id: "s1", type: "http", next: "s2" },
      { id: "s2", type: "transform" },
    ]))

    vi.mocked(getFeedbackByTemplate).mockImplementation((tid: string) => {
      if (tid === "tpl-single") {
        return Array.from({ length: 25 }, (_, i) => ({
          id: `fs-${i}`, workflowId: `w${i}`, workflowVersionId: null, templateId: tid, source: "template" as const,
          success: i < 15, durationMs: null, parameters: null, createdAt: "2024-01-01",
        }))
      }
      if (tid === "tpl-chain") {
        return Array.from({ length: 25 }, (_, i) => ({
          id: `fc-${i}`, workflowId: `w${i}`, workflowVersionId: null, templateId: tid, source: "template" as const,
          success: true, durationMs: null, parameters: null, createdAt: "2024-01-01",
        }))
      }
      return []
    })

    const svc = new StructuralEvolutionProposalService(registry)
    const proposals = svc.getProposals("tpl-single")
    const chain = proposals.find((p) => p.kind === "split_into_chain")
    // single_step successRate = 15/25 = 0.6
    // multi_step_chain successRate = 25/25 = 1.0
    // delta = 0.4 >= 0.15
    expect(chain).toBeDefined()
    expect(chain!.title).toBe("Split workflow into chained steps")
  })

  it("orders multiple proposals by confidence descending", () => {
    registry.registerInline(makeTemplate("tpl-single", [{ id: "s1", type: "http" }]))
    registry.registerInline(makeTemplate("tpl-chain", [
      { id: "s1", type: "http", next: "s2" },
      { id: "s2", type: "http" },
    ]))
    registry.registerInline(makeTemplate("tpl-param", [{ id: "s1", type: "http" }], "manual", [
      { name: "x", label: "X", type: "string" },
    ]))

    vi.mocked(getFeedbackByTemplate).mockImplementation((tid: string) => {
      const count = 25
      return Array.from({ length: count }, (_, i) => ({
        id: `f-${tid}-${i}`, workflowId: `w${i}`, workflowVersionId: null, templateId: tid, source: "template" as const,
        success: true, durationMs: null, parameters: null, createdAt: "2024-01-01",
      }))
    })

    const svc = new StructuralEvolutionProposalService(registry)
    const proposals = svc.getProposals("tpl-single")
    for (let i = 1; i < proposals.length; i++) {
      expect(proposals[i - 1].confidence).toBeGreaterThanOrEqual(proposals[i].confidence)
    }
  })

  it("returns empty for template that already has all features", () => {
    registry.registerInline(makeTemplate("tpl-full", [
      { id: "s1", type: "http", onFailure: { retry: { maxAttempts: 3 } } },
      { id: "s2", type: "transform" },
    ], "manual", [{ name: "x", label: "X", type: "string" }]))

    registry.registerInline(makeTemplate("tpl-chain", [
      { id: "s1", type: "http", next: "s2" },
      { id: "s2", type: "llm" },
    ]))

    vi.mocked(getFeedbackByTemplate).mockImplementation((tid: string) => {
      const count = tid === "tpl-full" ? 1 : 25
      return Array.from({ length: count }, (_, i) => ({
        id: `f-${tid}-${i}`, workflowId: `w${i}`, workflowVersionId: null, templateId: tid, source: "template" as const,
        success: true, durationMs: null, parameters: null, createdAt: "2024-01-01",
      }))
    })

    const svc = new StructuralEvolutionProposalService(registry)
    const proposals = svc.getProposals("tpl-full")
    // tpl-full has retry, has error handling, is parameterized, and is multi-step
    expect(proposals.length).toBe(0)
  })

  it("computes confidence correctly", () => {
    registry.registerInline(makeTemplate("tpl-1", [{ id: "s1", type: "http" }]))
    registry.registerInline(makeTemplate("tpl-retry", [{ id: "s1", type: "http", onFailure: { retry: { maxAttempts: 3 } } }]))

    vi.mocked(getFeedbackByTemplate).mockImplementation((tid: string) => {
      const count = tid === "tpl-retry" ? 25 : 1
      return Array.from({ length: count }, (_, i) => ({
        id: `f-${tid}-${i}`, workflowId: `w${i}`, workflowVersionId: null, templateId: tid, source: "template" as const,
        success: true, durationMs: null, parameters: null, createdAt: "2024-01-01",
      }))
    })

    const svc = new StructuralEvolutionProposalService(registry)
    const proposals = svc.getProposals("tpl-1")
    const retry = proposals.find((p) => p.kind === "add_retry")
    if (retry) {
      expect(retry.confidence).toBeGreaterThan(0)
      expect(retry.confidence).toBeLessThanOrEqual(1)
      expect(retry.confidence).toEqual(retry.evidence.avgSuccessRate * retry.evidence.avgConfidence)
    }
  })
})
