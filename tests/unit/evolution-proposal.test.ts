import { describe, it, expect, vi } from "vitest"
import { EvolutionProposalService } from "@arely/engine/evolution/evolution-proposal-service.js"

function mockRecommendations(overrides: Partial<{
  templateId: string
  recommendations: Array<{
    parameter: string
    suggestedValue: string
    successRate: number
    confidence: number
    executions: number
    score: number
    evidence: string
  }>
}> = {}) {
  return {
    templateId: overrides.templateId ?? "tpl-A",
    recommendations: overrides.recommendations ?? [
      {
        parameter: "interval",
        suggestedValue: "300",
        successRate: 0.9118,
        confidence: 1.0,
        executions: 34,
        score: 0.9118,
        evidence: "34 executions, 91% success rate",
      },
    ],
  }
}

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
          { value: "60", executions: 12, successes: 6, failures: 6, successRate: 0.5, confidence: 0.6, weightedSuccess: 0.3 },
        ],
      },
    ],
  }
}

function createMockServices(
  recReturn: ReturnType<typeof mockRecommendations>,
  insightReturn: ReturnType<typeof mockInsights>,
) {
  return {
    recommender: {
      getRecommendations: vi.fn().mockReturnValue(recReturn),
    } as any,
    effectivenessService: {
      getInsights: vi.fn().mockReturnValue(insightReturn),
    } as any,
  }
}

describe("EvolutionProposalService", () => {
  it("generates a valid proposal when thresholds are met", () => {
    const mocks = createMockServices(mockRecommendations(), mockInsights())
    const svc = new EvolutionProposalService(mocks.recommender, mocks.effectivenessService)
    const result = svc.getProposals("tpl-A")

    expect(result.templateId).toBe("tpl-A")
    expect(result.proposals).toHaveLength(1)

    const p = result.proposals[0]
    expect(p.type).toBe("parameter_change")
    expect(p.parameter).toBe("interval")
    expect(p.suggestedValue).toBe("300")
    expect(p.currentValue).toBe("60")
    expect(p.confidence).toBe(0.9118)
    expect(p.evidence.executions).toBe(34)
    expect(p.evidence.successRate).toBe(0.9118)
    expect(p.id).toMatch(/^evo_/)
    expect(p.createdAt).toBeDefined()
    expect(p.templateId).toBe("tpl-A")
  })

  it("does not generate a proposal with fewer than 20 executions", () => {
    const rec = mockRecommendations({
      recommendations: [
        {
          parameter: "interval",
          suggestedValue: "300",
          successRate: 1.0,
          confidence: 0.75,
          executions: 15,
          score: 0.75,
          evidence: "15 executions, 100% success rate",
        },
      ],
    })
    const mocks = createMockServices(rec, mockInsights())
    const svc = new EvolutionProposalService(mocks.recommender, mocks.effectivenessService)
    const result = svc.getProposals("tpl-A")

    expect(result.proposals).toEqual([])
  })

  it("does not generate a proposal with low score (< 0.60)", () => {
    const rec = mockRecommendations({
      recommendations: [
        {
          parameter: "interval",
          suggestedValue: "300",
          successRate: 0.7,
          confidence: 0.5,
          executions: 25,
          score: 0.35,
          evidence: "25 executions, 70% success rate",
        },
      ],
    })
    const mocks = createMockServices(rec, mockInsights())
    const svc = new EvolutionProposalService(mocks.recommender, mocks.effectivenessService)
    const result = svc.getProposals("tpl-A")

    expect(result.proposals).toEqual([])
  })

  it("confidence matches recommendation score", () => {
    const rec = mockRecommendations({
      recommendations: [
        {
          parameter: "timeout",
          suggestedValue: "5000",
          successRate: 0.95,
          confidence: 1.0,
          executions: 40,
          score: 0.95,
          evidence: "40 executions, 95% success rate",
        },
      ],
    })
    const insights = mockInsights({
      parameters: [
        {
          name: "timeout",
          values: [
            { value: "5000", executions: 40, successes: 38, failures: 2, successRate: 0.95, confidence: 1.0, weightedSuccess: 0.95 },
          ],
        },
      ],
    })
    const mocks = createMockServices(rec, insights)
    const svc = new EvolutionProposalService(mocks.recommender, mocks.effectivenessService)
    const result = svc.getProposals("tpl-A")

    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].confidence).toBe(0.95)
  })

  it("generates multiple proposals for multiple parameters", () => {
    const rec = mockRecommendations({
      recommendations: [
        {
          parameter: "interval",
          suggestedValue: "300",
          successRate: 0.9118,
          confidence: 1.0,
          executions: 34,
          score: 0.9118,
          evidence: "34 executions, 91% success rate",
        },
        {
          parameter: "timeout",
          suggestedValue: "5000",
          successRate: 0.9,
          confidence: 1.0,
          executions: 20,
          score: 0.9,
          evidence: "20 executions, 90% success rate",
        },
      ],
    })
    const insights = mockInsights({
      parameters: [
        {
          name: "interval",
          values: [
            { value: "300", executions: 34, successes: 31, failures: 3, successRate: 0.9118, confidence: 1.0, weightedSuccess: 0.9118 },
            { value: "60", executions: 12, successes: 6, failures: 6, successRate: 0.5, confidence: 0.6, weightedSuccess: 0.3 },
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
    })
    const mocks = createMockServices(rec, insights)
    const svc = new EvolutionProposalService(mocks.recommender, mocks.effectivenessService)
    const result = svc.getProposals("tpl-A")

    expect(result.proposals).toHaveLength(2)
    expect(result.proposals[0].parameter).toBe("interval")
    expect(result.proposals[1].parameter).toBe("timeout")
  })

  it("returns empty array when no recommendations exist", () => {
    const rec = mockRecommendations({ recommendations: [] })
    const mocks = createMockServices(rec, mockInsights())
    const svc = new EvolutionProposalService(mocks.recommender, mocks.effectivenessService)
    const result = svc.getProposals("tpl-A")

    expect(result.proposals).toEqual([])
  })

  it("sets currentValue from the most-executed alternative", () => {
    const rec = mockRecommendations({
      recommendations: [
        {
          parameter: "mode",
          suggestedValue: "fast",
          successRate: 0.9,
          confidence: 1.0,
          executions: 30,
          score: 0.9,
          evidence: "30 executions, 90% success rate",
        },
      ],
    })
    const insights = mockInsights({
      parameters: [
        {
          name: "mode",
          values: [
            { value: "slow", executions: 25, successes: 10, failures: 15, successRate: 0.4, confidence: 1.0, weightedSuccess: 0.4 },
            { value: "fast", executions: 30, successes: 27, failures: 3, successRate: 0.9, confidence: 1.0, weightedSuccess: 0.9 },
            { value: "medium", executions: 5, successes: 3, failures: 2, successRate: 0.6, confidence: 0.25, weightedSuccess: 0.15 },
          ],
        },
      ],
    })
    const mocks = createMockServices(rec, insights)
    const svc = new EvolutionProposalService(mocks.recommender, mocks.effectivenessService)
    const result = svc.getProposals("tpl-A")

    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].currentValue).toBe("slow")
  })
})
