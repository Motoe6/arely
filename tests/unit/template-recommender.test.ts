import { describe, it, expect } from "vitest"
import { TemplateRegistry } from "@opencode/engine/templates/template-registry.js"
import { TemplateRecommender } from "@opencode/engine/templates/template-recommender.js"
import type { Template } from "@opencode/engine/templates/template-types.js"

function makeTemplate(
  overrides: Partial<Template["metadata"]> & { id: string },
): Template {
  return {
    metadata: {
      name: overrides.id,
      description: "",
      category: "uncategorized",
      tags: [],
      templateVersion: "1.0.0",
      author: "Test",
      parameters: [],
      requires: [],
      source: "builtin",
      ...overrides,
    },
    workflowDsl: "",
    workflowObj: {},
  }
}

describe("TemplateRecommender", () => {
  describe("recommend", () => {
    it("matches by tag (exact)", () => {
      const registry = new TemplateRegistry()
      registry.registerInline(makeTemplate({
        id: "webhook-relay",
        name: "Webhook Relay",
        tags: ["webhook", "relay", "http"],
      }))
      registry.registerInline(makeTemplate({
        id: "llm-query",
        name: "LLM Query",
        tags: ["llm", "ai"],
      }))

      const recommender = new TemplateRecommender(registry)
      const results = recommender.recommend("webhook")
      expect(results).toHaveLength(1)
      expect(results[0].templateId).toBe("webhook-relay")
      expect(results[0].score).toBeGreaterThan(0)
    })

    it("matches by category", () => {
      const registry = new TemplateRegistry()
      registry.registerInline(makeTemplate({
        id: "health-check",
        name: "Health Check",
        category: "monitoring",
        tags: ["http"],
      }))
      registry.registerInline(makeTemplate({
        id: "api-chain",
        name: "API Chain",
        category: "integration",
        tags: ["http"],
      }))

      const recommender = new TemplateRecommender(registry)
      const results = recommender.recommend("monitoring")
      expect(results).toHaveLength(1)
      expect(results[0].templateId).toBe("health-check")
    })

    it("matches by description when tags and category miss", () => {
      const registry = new TemplateRegistry()
      registry.registerInline(makeTemplate({
        id: "api-chain",
        name: "API Chain",
        description: "Call one API then pipe its result into a second API call",
        tags: ["api", "chain", "http"],
        category: "integration",
      }))

      const recommender = new TemplateRecommender(registry)
      const results = recommender.recommend("pipe result")
      expect(results).toHaveLength(1)
      expect(results[0].templateId).toBe("api-chain")
    })

    it("ranks by score descending with stable ties", () => {
      const registry = new TemplateRegistry()
      registry.registerInline(makeTemplate({
        id: "basic-llm",
        name: "Basic LLM",
        description: "Basic query tool",
        tags: ["llm"],
      }))
      registry.registerInline(makeTemplate({
        id: "enhanced-llm",
        name: "Enhanced LLM",
        description: "LLM powered analysis tool",
        tags: ["llm"],
      }))

      const recommender = new TemplateRecommender(registry)
      const results = recommender.recommend("llm")
      expect(results).toHaveLength(2)
      expect(results[0].templateId).toBe("enhanced-llm")
      expect(results[1].templateId).toBe("basic-llm")
    })

    it("returns empty array when no matches", () => {
      const registry = new TemplateRegistry()
      registry.registerInline(makeTemplate({
        id: "webhook-relay",
        name: "Webhook Relay",
        tags: ["webhook"],
      }))

      const recommender = new TemplateRecommender(registry)
      const results = recommender.recommend("quantum flux capacitor")
      expect(results).toHaveLength(0)
    })

    it("ignores stop words in query", () => {
      const registry = new TemplateRegistry()
      registry.registerInline(makeTemplate({
        id: "webhook-relay",
        name: "Webhook Relay",
        description: "Relay webhooks to another endpoint",
        tags: ["webhook", "relay"],
      }))

      const recommender = new TemplateRecommender(registry)
      const withStop = recommender.recommend("a webhook for the relay")
      const withoutStop = recommender.recommend("webhook relay")
      expect(withStop).toEqual(withoutStop)
    })

    it("is case insensitive", () => {
      const registry = new TemplateRegistry()
      registry.registerInline(makeTemplate({
        id: "webhook-relay",
        name: "Webhook Relay",
        tags: ["WebHook", "Relay"],
      }))

      const recommender = new TemplateRecommender(registry)
      const lower = recommender.recommend("webhook")
      const upper = recommender.recommend("WebHook")
      const mixed = recommender.recommend("WEBHOOK")
      expect(lower).toHaveLength(1)
      expect(lower[0].templateId).toBe("webhook-relay")
      expect(lower).toEqual(upper)
      expect(lower).toEqual(mixed)
    })

    it("includes user templates in results", () => {
      const registry = new TemplateRegistry()
      registry.registerInline(makeTemplate({
        id: "my-custom-hook",
        name: "My Custom Webhook",
        description: "A custom webhook receiver",
        tags: ["webhook", "custom"],
        source: "user",
      }))

      const recommender = new TemplateRecommender(registry)
      const results = recommender.recommend("webhook")
      expect(results.some((r) => r.templateId === "my-custom-hook")).toBe(true)
    })

    it("includes built-in templates in results", () => {
      const registry = new TemplateRegistry()
      registry.registerInline(makeTemplate({
        id: "webhook-relay",
        name: "Webhook Relay",
        tags: ["webhook", "relay"],
        source: "builtin",
      }))

      const recommender = new TemplateRecommender(registry)
      const results = recommender.recommend("webhook relay")
      expect(results.some((r) => r.templateId === "webhook-relay")).toBe(true)
    })

    it("uses stable ordering on equal scores", () => {
      const registry = new TemplateRegistry()
      registry.registerInline(makeTemplate({
        id: "alpha-template",
        name: "Alpha",
        description: "monitoring endpoint checker tool",
        tags: ["monitoring"],
        category: "monitoring",
      }))
      registry.registerInline(makeTemplate({
        id: "beta-template",
        name: "Beta",
        description: "monitoring endpoint checker tool",
        tags: ["monitoring"],
        category: "monitoring",
      }))
      registry.registerInline(makeTemplate({
        id: "gamma-template",
        name: "Gamma",
        description: "monitoring endpoint checker tool",
        tags: ["monitoring"],
        category: "monitoring",
      }))

      const recommender = new TemplateRecommender(registry)
      const results = recommender.recommend("monitoring")
      expect(results).toHaveLength(3)
      expect(results[0].templateId < results[1].templateId).toBe(true)
      expect(results[1].templateId < results[2].templateId).toBe(true)
    })
  })
})
