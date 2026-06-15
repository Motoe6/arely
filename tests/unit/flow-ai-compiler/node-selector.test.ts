import { describe, it, expect, beforeEach } from "vitest"
import { NodeRegistry, LLMNode, HttpNode } from "@arelyos/flow-sdk"
import { selectNodes, scoreStep, pickBest, deriveMetadata, registerCustomKeywords, NodeSelectionError } from "@arelyos/flow-ai-compiler"

function makeStep(overrides: Partial<Parameters<typeof scoreStep>[0]> = {}): Parameters<typeof scoreStep>[0] {
  return {
    id: "s1",
    description: "test step",
    intent: "fetch data",
    ...overrides,
  }
}

describe("Node Selector — B.2", () => {
  let registry: NodeRegistry

  beforeEach(() => {
    registry = new NodeRegistry()
    registry.register(HttpNode)
    registry.register(LLMNode)
  })

  describe("scoreStep", () => {
    it("exact match via typeHint returns confidence 1.0", () => {
      const step = makeStep({ intent: "do http", typeHint: "http" })
      const node = { definition: HttpNode, metadata: deriveMetadata(HttpNode) }
      const match = scoreStep(step, node)
      expect(match.confidence).toBe(1.0)
      expect(match.strategy).toBe("exact")
    })

    it("intent_pattern match returns confidence 0.85", () => {
      const step = makeStep({ intent: "fetch" })
      const node = { definition: HttpNode, metadata: deriveMetadata(HttpNode) }
      const match = scoreStep(step, node)
      expect(match.confidence).toBe(0.85)
      expect(match.strategy).toBe("intent_pattern")
    })

    it("keyword overlap returns confidence 0.5–0.8", () => {
      const step = makeStep({ intent: "fetch user data" })
      const node = { definition: HttpNode, metadata: deriveMetadata(HttpNode) }
      const match = scoreStep(step, node)
      expect(match.confidence).toBeGreaterThanOrEqual(0.5)
      expect(match.confidence).toBeLessThanOrEqual(0.8)
      expect(match.strategy).toBe("keyword")
    })

    it("LLM intent scores higher on LLMNode", () => {
      const step = makeStep({ intent: "generate text with ai" })
      const httpNode = { definition: HttpNode, metadata: deriveMetadata(HttpNode) }
      const llmNode = { definition: LLMNode, metadata: deriveMetadata(LLMNode) }

      const httpScore = scoreStep(step, httpNode)
      const llmScore = scoreStep(step, llmNode)

      expect(llmScore.confidence).toBeGreaterThan(httpScore.confidence)
    })

    it("no overlap returns confidence 0", () => {
      const step = makeStep({ intent: "xylophone zephyr quark" })
      const node = { definition: HttpNode, metadata: deriveMetadata(HttpNode) }
      const match = scoreStep(step, node)
      expect(match.confidence).toBe(0)
    })
  })

  describe("pickBest", () => {
    it("returns highest confidence match", () => {
      const step = makeStep()
      const selectables = [
        { definition: HttpNode, metadata: deriveMetadata(HttpNode) },
        { definition: LLMNode, metadata: deriveMetadata(LLMNode) },
      ]
      const matches = selectables.map((n) => scoreStep(step, n))
      const best = pickBest(matches, step, selectables)
      expect(best.confidence).toBeGreaterThanOrEqual(0.5)
    })

    it("falls back to category fallback when below threshold", () => {
      const step = makeStep({ intent: "xylophone zephyr", typeHint: "fetch" })
      const matches = [
        { nodeType: "llm", confidence: 0, strategy: "keyword" as const, definition: LLMNode },
        { nodeType: "http", confidence: 0, strategy: "keyword" as const, definition: HttpNode },
      ]
      const selectables = [
        { definition: HttpNode, metadata: deriveMetadata(HttpNode) },
        { definition: LLMNode, metadata: deriveMetadata(LLMNode) },
      ]
      const best = pickBest(matches, step, selectables)
      expect(best.strategy).toBe("category_fallback")
      expect(best.confidence).toBe(0.4)
    })

    it("falls back to generic http when nothing matches", () => {
      const step = makeStep({ intent: "xylophone zephyr" })
      const matches = [
        { nodeType: "llm", confidence: 0, strategy: "keyword" as const, definition: LLMNode },
        { nodeType: "http", confidence: 0, strategy: "keyword" as const, definition: HttpNode },
      ]
      const selectables = [
        { definition: HttpNode, metadata: deriveMetadata(HttpNode) },
        { definition: LLMNode, metadata: deriveMetadata(LLMNode) },
      ]
      const best = pickBest(matches, step, selectables)
      expect(best.strategy).toBe("generic_fallback")
      expect(best.confidence).toBe(0.3)
    })

    it("throws when no selectable nodes available", () => {
      const step = makeStep()
      expect(() => pickBest([], step, [])).toThrow(NodeSelectionError)
    })
  })

  describe("selectNodes (integration)", () => {
    it("resolves http intent to HttpNode", () => {
      const steps = [makeStep({ id: "s1", intent: "fetch data", typeHint: "http" })]
      const resolved = selectNodes(steps, registry)
      expect(resolved).toHaveLength(1)
      expect(resolved[0].nodeType).toBe("http")
      expect(resolved[0].match.confidence).toBe(1.0)
    })

    it("resolves LLM intent to LLMNode", () => {
      const steps = [makeStep({ id: "s1", intent: "summarize with ai", typeHint: "llm" })]
      const resolved = selectNodes(steps, registry)
      expect(resolved).toHaveLength(1)
      expect(resolved[0].nodeType).toBe("llm")
    })

    it("resolves unknown intent via fallback", () => {
      const steps = [makeStep({ id: "s1", intent: "xylophone zephyr quark" })]
      const resolved = selectNodes(steps, registry)
      expect(resolved).toHaveLength(1)
      expect(resolved[0].nodeType).toBe("http")
      expect(resolved[0].match.strategy).toBe("generic_fallback")
    })

    it("resolves multiple steps independently", () => {
      const steps = [
        makeStep({ id: "fetch", intent: "fetch user data", typeHint: "http" }),
        makeStep({ id: "analyze", intent: "analyze with llm", typeHint: "llm" }),
        makeStep({ id: "save", intent: "save to database" }),
      ]
      const resolved = selectNodes(steps, registry)
      expect(resolved).toHaveLength(3)
      expect(resolved[0].nodeType).toBe("http")
      expect(resolved[1].nodeType).toBe("llm")
      expect(resolved[2].nodeType).toBe("http")
    })

    it("throws when registry is empty", () => {
      const empty = new NodeRegistry()
      expect(() => selectNodes([makeStep()], empty)).toThrow("No nodes registered")
    })
  })

  describe("registerCustomKeywords", () => {
    it("custom keywords improve matching", () => {
      registerCustomKeywords("http", ["database", "save", "store"])
      const step = makeStep({ intent: "save data to database" })
      const node = { definition: HttpNode, metadata: deriveMetadata(HttpNode) }
      const match = scoreStep(step, node)
      expect(match.confidence).toBeGreaterThan(0.5)
    })
  })
})
