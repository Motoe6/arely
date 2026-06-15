import { describe, it, expect, vi } from "vitest"
import { ParameterEffectivenessService } from "@arely/engine/templates/parameter-effectiveness.js"

function mockFeedback(overrides: Partial<{
  templateId: string
  success: boolean
  parameters: Record<string, string> | null
}>[]) {
  return overrides.map((o) => ({
    id: "mock-id",
    workflowId: "mock-wf",
    workflowVersionId: null,
    templateId: o.templateId ?? "tpl-A",
    source: "evolved" as const,
    success: o.success ?? true,
    durationMs: null,
    parameters: o.parameters ?? null,
    createdAt: new Date().toISOString(),
  }))
}

vi.mock("@arely/engine/persistence/feedback-store.js", () => ({
  getFeedbackByTemplate: vi.fn(),
}))

import { getFeedbackByTemplate } from "@arely/engine/persistence/feedback-store.js"

describe("ParameterEffectivenessService", () => {
  it("returns empty when no feedback with parameters", () => {
    vi.mocked(getFeedbackByTemplate).mockReturnValue(mockFeedback([
      { parameters: null },
      { parameters: {} },
    ]))
    const svc = new ParameterEffectivenessService()
    const result = svc.getInsights("tpl-A")
    expect(result.templateId).toBe("tpl-A")
    expect(result.parameters).toEqual([])
  })

  it("aggregates a single parameter with multiple values", () => {
    vi.mocked(getFeedbackByTemplate).mockReturnValue(mockFeedback([
      { parameters: { interval: "5m" }, success: true },
      { parameters: { interval: "5m" }, success: true },
      { parameters: { interval: "5m" }, success: false },
      { parameters: { interval: "1m" }, success: true },
      { parameters: { interval: "1m" }, success: false },
    ]))
    const svc = new ParameterEffectivenessService()
    const result = svc.getInsights("tpl-A")
    expect(result.parameters).toHaveLength(1)
    expect(result.parameters[0].name).toBe("interval")
    expect(result.parameters[0].values).toHaveLength(2)

    const fiveM = result.parameters[0].values.find((v) => v.value === "5m")
    expect(fiveM).toBeDefined()
    expect(fiveM!.executions).toBe(3)
    expect(fiveM!.successes).toBe(2)
    expect(fiveM!.successRate).toBeCloseTo(2 / 3, 5)
    expect(fiveM!.confidence).toBe(0.15)

    const oneM = result.parameters[0].values.find((v) => v.value === "1m")
    expect(oneM).toBeDefined()
    expect(oneM!.executions).toBe(2)
    expect(oneM!.successes).toBe(1)
    expect(oneM!.successRate).toBe(0.5)
  })

  it("computes confidence correctly reusing T7.2 formula", () => {
    vi.mocked(getFeedbackByTemplate).mockReturnValue(mockFeedback(
      Array.from({ length: 40 }, (_, i) => ({
        parameters: { retries: "3" },
        success: i < 35,
      })),
    ))
    const svc = new ParameterEffectivenessService()
    const result = svc.getInsights("tpl-A")
    const retries = result.parameters[0].values[0]
    expect(retries.executions).toBe(40)
    expect(retries.confidence).toBe(1.0)
    expect(retries.weightedSuccess).toBeCloseTo(retries.successRate * 1.0, 5)
  })

  it("handles multiple parameters", () => {
    vi.mocked(getFeedbackByTemplate).mockReturnValue(mockFeedback([
      { parameters: { interval: "5m", provider: "openrouter" }, success: true },
      { parameters: { interval: "5m", provider: "anthropic" }, success: false },
      { parameters: { interval: "1m", provider: "openrouter" }, success: true },
    ]))
    const svc = new ParameterEffectivenessService()
    const result = svc.getInsights("tpl-A")
    expect(result.parameters.length).toBeGreaterThanOrEqual(2)
    const names = result.parameters.map((p) => p.name).sort()
    expect(names).toEqual(["interval", "provider"])
  })

  it("ignores feedback without parameters", () => {
    vi.mocked(getFeedbackByTemplate).mockReturnValue(mockFeedback([
      { parameters: null, success: true },
      { parameters: { env: "prod" }, success: true },
      { parameters: {}, success: false },
    ]))
    const svc = new ParameterEffectivenessService()
    const result = svc.getInsights("tpl-A")
    expect(result.parameters).toHaveLength(1)
    expect(result.parameters[0].name).toBe("env")
  })

  it("ensures weightedSuccess <= successRate", () => {
    vi.mocked(getFeedbackByTemplate).mockReturnValue(mockFeedback(
      Array.from({ length: 10 }, (_, i) => ({
        parameters: { mode: i < 7 ? "fast" : "slow" },
        success: i < 8,
      })),
    ))
    const svc = new ParameterEffectivenessService()
    const result = svc.getInsights("tpl-A")
    for (const param of result.parameters) {
      for (const val of param.values) {
        expect(val.weightedSuccess).toBeLessThanOrEqual(val.successRate + 0.001)
      }
    }
  })

  it("returns empty for template with no feedback at all", () => {
    vi.mocked(getFeedbackByTemplate).mockReturnValue([])
    const svc = new ParameterEffectivenessService()
    const result = svc.getInsights("nonexistent")
    expect(result.templateId).toBe("nonexistent")
    expect(result.parameters).toEqual([])
  })
})
