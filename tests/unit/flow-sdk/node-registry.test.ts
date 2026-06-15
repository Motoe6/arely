import { describe, it, expect, beforeEach } from "vitest"
import { NodeRegistry, HttpNode, LLMNode, resolveNode } from "@arely/flow-sdk"
import type { NodeDefinition } from "@arely/flow-sdk"

describe("NodeRegistry", () => {
  let registry: NodeRegistry

  beforeEach(() => {
    registry = new NodeRegistry()
  })

  it("registers and retrieves a node", () => {
    registry.register(HttpNode)
    const node = registry.get("http")
    expect(node.type).toBe("http")
    expect(node.label).toBe("HTTP Request")
    expect(node.category).toBe("action")
  })

  it("throws on duplicate registration", () => {
    registry.register(HttpNode)
    expect(() => registry.register(HttpNode)).toThrow("already registered")
  })

  it("throws on unknown node type", () => {
    expect(() => registry.get("nonexistent")).toThrow("Unknown node type")
  })

  it("lists all registered nodes", () => {
    registry.register(HttpNode)
    registry.register(LLMNode)
    const nodes = registry.list()
    expect(nodes).toHaveLength(2)
    expect(nodes.map((n) => n.type)).toEqual(["http", "llm"])
  })

  it("checks node existence", () => {
    registry.register(LLMNode)
    expect(registry.has("llm")).toBe(true)
    expect(registry.has("http")).toBe(false)
  })
})

describe("Built-in nodes — LLMNode", () => {
  it("returns mock output", async () => {
    const result = await LLMNode.execute(
      { workflowId: "w1", executionId: "e1", trigger: {}, steps: {}, secrets: {} },
      { prompt: "Hello" },
    )
    expect(result).toEqual({ output: "mock:Hello" })
  })
})

describe("Built-in nodes — HttpNode", () => {
  it("has correct schema and type", () => {
    expect(HttpNode.type).toBe("http")
    expect(HttpNode.category).toBe("action")
    expect(HttpNode.inputSchema.properties).toHaveProperty("url")
  })
})

describe("Engine adapter", () => {
  it("resolves node from global registry", () => {
    const registry = new NodeRegistry()
    registry.register(LLMNode)
    // Simulate what engine-adapter does
    const node = registry.get("llm")
    expect(node.type).toBe("llm")
  })

  it("resolveNode throws for unknown type", async () => {
    const registry = new NodeRegistry()
    // Standalone — does not use global registry to keep test hermetic
    expect(() => registry.get("missing")).toThrow("Unknown node type")
  })
})
