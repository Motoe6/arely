import { describe, it, expect, vi, beforeEach } from "vitest"
import { StructuralInsightsService } from "@arelyos/engine/structural/structural-insights-service.js"
import { TemplateRegistry } from "@arelyos/engine/templates/template-registry.js"
import type { Template } from "@arelyos/engine/templates/template-types.js"

vi.mock("@arelyos/persistence", async () => {
  const actual = await vi.importActual("@arelyos/persistence")
  return { ...actual, getFeedbackByTemplate: vi.fn() }
})

import { getFeedbackByTemplate } from "@arelyos/persistence"

function makeTemplate(id: string, overrides: Partial<Template> = {}): Template {
  return {
    metadata: {
      id,
      name: "Test",
      description: "",
      category: "default",
      tags: [],
      templateVersion: "1.0.0",
      author: "Test",
      parameters: [],
      requires: [],
      source: "builtin",
    },
    workflowDsl: "",
    workflowObj: { name: "test", steps: [], trigger: { type: "manual" } },
    ...overrides,
  }
}

describe("StructuralInsightsService", () => {
  let registry: TemplateRegistry

  beforeEach(() => {
    vi.clearAllMocks()
    registry = new TemplateRegistry()
  })

  it("returns empty insights when no templates registered", () => {
    const svc = new StructuralInsightsService(registry)
    const result = svc.getInsights()
    expect(result.overall).toEqual([])
    expect(result.byCategory).toEqual({})
  })

  it("returns single_step insight for a single-step template", () => {
    registry.registerInline(makeTemplate("tpl-1", {
      workflowObj: { name: "wf", steps: [{ id: "s1", type: "http" }], trigger: { type: "manual" } },
    }))

    vi.mocked(getFeedbackByTemplate).mockReturnValue([
      { id: "fb-1", workflowId: "w1", workflowVersionId: null, templateId: "tpl-1", source: "template", success: true, durationMs: 100, parameters: null, createdAt: "2024-01-01" },
      { id: "fb-2", workflowId: "w2", workflowVersionId: null, templateId: "tpl-1", source: "template", success: true, durationMs: 200, parameters: null, createdAt: "2024-01-02" },
    ])

    const svc = new StructuralInsightsService(registry)
    const result = svc.getInsights()

    expect(result.overall.length).toBeGreaterThanOrEqual(1)
    const si = result.overall.find((x) => x.pattern === "single_step")
    expect(si).toBeDefined()
    expect(si!.frequency).toBe(1)
    expect(si!.totalTemplates).toBe(1)
    expect(si!.frequencyPct).toBe(100)
    expect(si!.sampleExecutions).toBe(2)
    expect(si!.avgSuccessRate).toBe(1)
    expect(si!.label).toBe("Single step")
  })

  it("computes avgSuccessRate from feedback data", () => {
    registry.registerInline(makeTemplate("tpl-success", {
      workflowObj: { name: "wf", steps: [{ id: "s1", type: "http" }], trigger: { type: "manual" } },
    }))

    vi.mocked(getFeedbackByTemplate).mockReturnValue([
      { id: "f1", workflowId: "w1", workflowVersionId: null, templateId: "tpl-success", source: "template", success: true, durationMs: null, parameters: null, createdAt: "2024-01-01" },
      { id: "f2", workflowId: "w2", workflowVersionId: null, templateId: "tpl-success", source: "template", success: false, durationMs: null, parameters: null, createdAt: "2024-01-02" },
      { id: "f3", workflowId: "w3", workflowVersionId: null, templateId: "tpl-success", source: "template", success: true, durationMs: null, parameters: null, createdAt: "2024-01-03" },
    ])

    const svc = new StructuralInsightsService(registry)
    const result = svc.getInsights()

    const si = result.overall.find((x) => x.pattern === "single_step")
    expect(si!.sampleExecutions).toBe(3)
    expect(si!.avgSuccessRate).toBe(0.667)
  })

  it("includes multiple patterns for multi-step templates", () => {
    registry.registerInline(makeTemplate("tpl-chain", {
      workflowObj: {
        name: "wf",
        steps: [
          { id: "s1", type: "http", next: "s2" },
          { id: "s2", type: "llm" },
        ],
        trigger: { type: "webhook" },
      },
    }))

    vi.mocked(getFeedbackByTemplate).mockReturnValue([])

    const svc = new StructuralInsightsService(registry)
    const result = svc.getInsights()

    expect(result.overall.some((x) => x.pattern === "http_llm_chain")).toBe(true)
    expect(result.overall.some((x) => x.pattern === "webhook_trigger")).toBe(true)
    expect(result.overall.some((x) => x.pattern === "multi_step_chain")).toBe(true)
  })

  it("groups insights by category", () => {
    registry.registerInline(makeTemplate("tpl-cat1", {
      metadata: { id: "tpl-cat1", name: "T1", description: "", category: "networking", tags: [], templateVersion: "1.0.0", author: "", parameters: [], requires: [], source: "builtin" },
      workflowObj: { name: "wf", steps: [{ id: "s1", type: "http" }], trigger: { type: "manual" } },
    }))
    registry.registerInline(makeTemplate("tpl-cat2", {
      metadata: { id: "tpl-cat2", name: "T2", description: "", category: "ai", tags: [], templateVersion: "1.0.0", author: "", parameters: [], requires: [], source: "builtin" },
      workflowObj: { name: "wf", steps: [{ id: "s1", type: "http" }], trigger: { type: "schedule" } },
    }))

    vi.mocked(getFeedbackByTemplate).mockReturnValue([])

    const svc = new StructuralInsightsService(registry)
    const result = svc.getInsights()

    expect(Object.keys(result.byCategory).sort()).toEqual(["ai", "networking"])
    expect(result.byCategory.networking.some((x) => x.pattern === "single_step")).toBe(true)
    expect(result.byCategory.ai.some((x) => x.pattern === "schedule_trigger")).toBe(true)
  })

  it("sorts insights by frequency descending", () => {
    registry.registerInline(makeTemplate("tpl-a", {
      metadata: { id: "tpl-a", name: "A", description: "", category: "default", tags: [], templateVersion: "1.0.0", author: "", parameters: [{ name: "x", label: "X", type: "string" }], requires: [], source: "builtin" },
      workflowObj: { name: "wf", steps: [{ id: "s1", type: "http" }], trigger: { type: "manual" } },
    }))
    registry.registerInline(makeTemplate("tpl-b", {
      metadata: { id: "tpl-b", name: "B", description: "", category: "default", tags: [], templateVersion: "1.0.0", author: "", parameters: [], requires: [], source: "builtin" },
      workflowObj: { name: "wf", steps: [{ id: "s1", type: "http" }], trigger: { type: "manual" } },
    }))

    vi.mocked(getFeedbackByTemplate).mockReturnValue([])

    const svc = new StructuralInsightsService(registry)
    const result = svc.getInsights()

    for (let i = 1; i < result.overall.length; i++) {
      expect(result.overall[i - 1].frequency).toBeGreaterThanOrEqual(result.overall[i].frequency)
    }
  })

  it("handles templates not in registry gracefully", () => {
    const svc = new StructuralInsightsService(registry)
    const result = svc.getInsights()
    expect(result.overall).toEqual([])
  })
})
