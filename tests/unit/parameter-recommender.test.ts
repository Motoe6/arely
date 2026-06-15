import { describe, it, expect, vi } from "vitest"
import { ParameterRecommenderService } from "@arely/engine/templates/parameter-recommender.js"
import { ParameterEffectivenessService } from "@arely/engine/templates/parameter-effectiveness.js"

function mockInsights(overrides: Partial<{
  templateId: string
  parameters: Array<{
    name: string
    values: Array<{
      value: string
      executions: number
      successes: number
      failures: number
      successRate: number
      confidence: number
      weightedSuccess: number
    }>
  }>
}> = {}) {
  return {
    templateId: overrides.templateId ?? "tpl-A",
    parameters: overrides.parameters ?? [
      {
        name: "interval",
        values: [
          { value: "300", executions: 34, successes: 31, failures: 3, successRate: 0.9118, confidence: 1.0, weightedSuccess: 0.9118 },
          { value: "600", executions: 12, successes: 8, failures: 4, successRate: 0.6667, confidence: 0.6, weightedSuccess: 0.4 },
          { value: "60", executions: 3, successes: 3, failures: 0, successRate: 1.0, confidence: 0.15, weightedSuccess: 0.15 },
        ],
      },
      {
        name: "timeout",
        values: [
          { value: "5000", executions: 20, successes: 18, failures: 2, successRate: 0.9, confidence: 1.0, weightedSuccess: 0.9 },
          { value: "1000", executions: 8, successes: 4, failures: 4, successRate: 0.5, confidence: 0.4, weightedSuccess: 0.2 },
        ],
      },
    ],
  }
}

function createMockService(returnValue: ReturnType<typeof mockInsights>) {
  return {
    getInsights: vi.fn().mockReturnValue(returnValue),
  } as unknown as ParameterEffectivenessService
}

describe("ParameterRecommenderService", () => {
  it("recommends the best value per parameter based on score", () => {
    const mock = createMockService(mockInsights())
    const svc = new ParameterRecommenderService(mock)
    const result = svc.getRecommendations("tpl-A")

    expect(result.templateId).toBe("tpl-A")
    expect(result.recommendations).toHaveLength(2)

    const intervalRec = result.recommendations.find((r) => r.parameter === "interval")
    expect(intervalRec).toBeDefined()
    expect(intervalRec!.suggestedValue).toBe("300")
    expect(intervalRec!.executions).toBe(34)

    const timeoutRec = result.recommendations.find((r) => r.parameter === "timeout")
    expect(timeoutRec).toBeDefined()
    expect(timeoutRec!.suggestedValue).toBe("5000")
    expect(timeoutRec!.executions).toBe(20)
  })

  it("ignores values with fewer than 5 executions", () => {
    const mock = createMockService(mockInsights({
      parameters: [
        {
          name: "retries",
          values: [
            { value: "3", executions: 20, successes: 18, failures: 2, successRate: 0.9, confidence: 1.0, weightedSuccess: 0.9 },
            { value: "5", executions: 3, successes: 3, failures: 0, successRate: 1.0, confidence: 0.15, weightedSuccess: 0.15 },
          ],
        },
      ],
    }))
    const svc = new ParameterRecommenderService(mock)
    const result = svc.getRecommendations("tpl-A")

    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0].suggestedValue).toBe("3")
  })

  it("ignores values with successRate below 0.60", () => {
    const mock = createMockService(mockInsights({
      parameters: [
        {
          name: "timeout",
          values: [
            { value: "5000", executions: 10, successes: 9, failures: 1, successRate: 0.9, confidence: 0.5, weightedSuccess: 0.45 },
            { value: "1000", executions: 10, successes: 4, failures: 6, successRate: 0.4, confidence: 0.5, weightedSuccess: 0.2 },
          ],
        },
      ],
    }))
    const svc = new ParameterRecommenderService(mock)
    const result = svc.getRecommendations("tpl-A")

    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0].suggestedValue).toBe("5000")
  })

  it("sorts recommendations by score descending", () => {
    const mock = createMockService(mockInsights())
    const svc = new ParameterRecommenderService(mock)
    const result = svc.getRecommendations("tpl-A")

    for (let i = 1; i < result.recommendations.length; i++) {
      expect(result.recommendations[i - 1].score).toBeGreaterThanOrEqual(result.recommendations[i].score)
    }
  })

  it("returns empty when no parameter data exists", () => {
    const mock = createMockService({ templateId: "tpl-A", parameters: [] })
    const svc = new ParameterRecommenderService(mock)
    const result = svc.getRecommendations("tpl-A")

    expect(result.recommendations).toEqual([])
  })

  it("computes score as successRate * confidence²", () => {
    const mock = createMockService(mockInsights({
      parameters: [
        {
          name: "mode",
          values: [
            { value: "fast", executions: 20, successes: 18, failures: 2, successRate: 0.9, confidence: 1.0, weightedSuccess: 0.9 },
          ],
        },
      ],
    }))
    const svc = new ParameterRecommenderService(mock)
    const result = svc.getRecommendations("tpl-A")

    expect(result.recommendations[0].score).toBeCloseTo(0.9 * 1.0 * 1.0, 5)
  })

  it("returns evidence string matching format", () => {
    const mock = createMockService(mockInsights({
      parameters: [
        {
          name: "interval",
          values: [
            { value: "300", executions: 34, successes: 31, failures: 3, successRate: 0.9118, confidence: 1.0, weightedSuccess: 0.9118 },
          ],
        },
      ],
    }))
    const svc = new ParameterRecommenderService(mock)
    const result = svc.getRecommendations("tpl-A")

    expect(result.recommendations[0].evidence).toMatch(/34 executions, 91% success rate/)
  })
})
