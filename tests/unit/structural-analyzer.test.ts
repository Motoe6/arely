import { describe, it, expect } from "vitest"
import { StructuralAnalyzer } from "@arely/engine/structural/structural-analyzer.js"
import type { Template } from "@arely/engine/templates/template-types.js"

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    metadata: {
      id: "tpl-test",
      name: "Test Template",
      description: "Test",
      category: "test",
      tags: [],
      templateVersion: "1.0.0",
      author: "Test",
      parameters: [],
      requires: [],
      source: "builtin",
    },
    workflowDsl: "",
    workflowObj: { name: "test-workflow", steps: [], trigger: { type: "manual" } },
    ...overrides,
  }
}

describe("StructuralAnalyzer", () => {
  const analyzer = new StructuralAnalyzer()

  describe("analyze", () => {
    it("detects single step with no chaining", () => {
      const t = makeTemplate({
        workflowObj: {
          name: "wf",
          steps: [{ id: "s1", type: "http" }],
          trigger: { type: "manual" },
        },
      })
      const f = analyzer.analyze(t)
      expect(f.stepCount).toBe(1)
      expect(f.stepTypes).toEqual(["http"])
      expect(f.hasChaining).toBe(false)
      expect(f.maxChainDepth).toBe(1)
      expect(f.hasConditionalBranches).toBe(false)
      expect(f.hasFanOut).toBe(false)
      expect(f.hasErrorHandling).toBe(false)
      expect(f.hasRetryConfig).toBe(false)
      expect(f.triggerType).toBe("manual")
      expect(f.usesDynamicName).toBe(false)
      expect(f.parameterCount).toBe(0)
      expect(f.isParameterized).toBe(false)
    })

    it("detects chain of steps", () => {
      const t = makeTemplate({
        workflowObj: {
          name: "wf",
          steps: [
            { id: "s1", type: "http", next: "s2" },
            { id: "s2", type: "transform", next: "s3" },
            { id: "s3", type: "llm" },
          ],
          trigger: { type: "manual" },
        },
      })
      const f = analyzer.analyze(t)
      expect(f.stepCount).toBe(3)
      expect(f.hasChaining).toBe(true)
      expect(f.maxChainDepth).toBe(3)
      expect(f.hasConditionalBranches).toBe(false)
      expect(f.hasFanOut).toBe(false)
    })

    it("detects fan-out branches", () => {
      const t = makeTemplate({
        workflowObj: {
          name: "wf",
          steps: [
            { id: "s1", type: "http", next: ["s2", "s3"] },
            { id: "s2", type: "transform" },
            { id: "s3", type: "llm" },
          ],
          trigger: { type: "manual" },
        },
      })
      const f = analyzer.analyze(t)
      expect(f.hasFanOut).toBe(true)
      expect(f.hasConditionalBranches).toBe(true)
      expect(f.maxChainDepth).toBe(2)
    })

    it("detects error handling", () => {
      const t = makeTemplate({
        workflowObj: {
          name: "wf",
          steps: [
            { id: "s1", type: "http", onFailure: { retry: { maxAttempts: 3 } } },
          ],
          trigger: { type: "manual" },
        },
      })
      const f = analyzer.analyze(t)
      expect(f.hasErrorHandling).toBe(true)
      expect(f.hasRetryConfig).toBe(true)
    })

    it("detects error handling without retry", () => {
      const t = makeTemplate({
        workflowObj: {
          name: "wf",
          steps: [
            { id: "s1", type: "http", onFailure: { fallback: "s2" } },
          ],
          trigger: { type: "manual" },
        },
      })
      const f = analyzer.analyze(t)
      expect(f.hasErrorHandling).toBe(true)
      expect(f.hasRetryConfig).toBe(false)
    })

    it("detects trigger types", () => {
      const webhook = makeTemplate({
        workflowObj: { name: "wf", steps: [], trigger: { type: "webhook" } },
      })
      const schedule = makeTemplate({
        workflowObj: { name: "wf", steps: [], trigger: { type: "schedule" } },
      })
      expect(analyzer.analyze(webhook).triggerType).toBe("webhook")
      expect(analyzer.analyze(schedule).triggerType).toBe("schedule")
    })

    it("detects dynamic name", () => {
      const t = makeTemplate({
        metadata: { id: "tpl-dyn", name: "{{ param:workflowName }}", description: "", category: "", tags: [], templateVersion: "1.0.0", author: "", parameters: [], requires: [], source: "builtin" },
        workflowObj: { name: "{{ param:workflowName }}", steps: [], trigger: { type: "manual" } },
      })
      expect(analyzer.analyze(t).usesDynamicName).toBe(true)
    })

    it("detects parameterized templates", () => {
      const t = makeTemplate({
        metadata: { id: "tpl-param", name: "Test", description: "", category: "", tags: [], templateVersion: "1.0.0", author: "", parameters: [{ name: "url", label: "URL", type: "string", required: true }, { name: "interval", label: "Interval", type: "number", required: false }], requires: [], source: "builtin" },
      })
      const f = analyzer.analyze(t)
      expect(f.parameterCount).toBe(2)
      expect(f.isParameterized).toBe(true)
    })

    it("computes maxChainDepth correctly with branches", () => {
      const t = makeTemplate({
        workflowObj: {
          name: "wf",
          steps: [
            { id: "s1", type: "http", next: "s2" },
            { id: "s2", type: "condition", next: ["s3", "s4"] },
            { id: "s3", type: "log" },
            { id: "s4", type: "llm", next: "s5" },
            { id: "s5", type: "notify" },
          ],
          trigger: { type: "manual" },
        },
      })
      const f = analyzer.analyze(t)
      expect(f.maxChainDepth).toBe(4)
    })

    it("returns 0 for empty steps", () => {
      const t = makeTemplate({
        workflowObj: { name: "wf", steps: [], trigger: { type: "manual" } },
      })
      const f = analyzer.analyze(t)
      expect(f.stepCount).toBe(0)
      expect(f.maxChainDepth).toBe(0)
    })
  })

  describe("detectPatterns", () => {
    it("detects single_step", () => {
      const t = makeTemplate({
        workflowObj: { name: "wf", steps: [{ id: "s1", type: "http" }], trigger: { type: "manual" } },
      })
      const matches = analyzer.detectPatterns(t)
      expect(matches.some((m) => m.pattern === "single_step")).toBe(true)
    })

    it("detects multi_step_chain", () => {
      const t = makeTemplate({
        workflowObj: {
          name: "wf",
          steps: [
            { id: "s1", type: "http", next: "s2" },
            { id: "s2", type: "transform" },
          ],
          trigger: { type: "manual" },
        },
      })
      const matches = analyzer.detectPatterns(t)
      expect(matches.some((m) => m.pattern === "multi_step_chain")).toBe(true)
    })

    it("detects strict http_llm_chain (http → llm only)", () => {
      const t = makeTemplate({
        workflowObj: {
          name: "wf",
          steps: [
            { id: "s1", type: "http", next: "s2" },
            { id: "s2", type: "llm" },
          ],
          trigger: { type: "manual" },
        },
      })
      const matches = analyzer.detectPatterns(t)
      expect(matches.some((m) => m.pattern === "http_llm_chain")).toBe(true)
    })

    it("does not detect http_llm_chain with intermediate step", () => {
      const t = makeTemplate({
        workflowObj: {
          name: "wf",
          steps: [
            { id: "s1", type: "http", next: "s2" },
            { id: "s2", type: "transform", next: "s3" },
            { id: "s3", type: "llm" },
          ],
          trigger: { type: "manual" },
        },
      })
      const matches = analyzer.detectPatterns(t)
      expect(matches.some((m) => m.pattern === "http_llm_chain")).toBe(false)
    })

    it("detects webhook_trigger", () => {
      const t = makeTemplate({
        workflowObj: { name: "wf", steps: [], trigger: { type: "webhook" } },
      })
      const matches = analyzer.detectPatterns(t)
      expect(matches.some((m) => m.pattern === "webhook_trigger")).toBe(true)
    })

    it("detects schedule_trigger", () => {
      const t = makeTemplate({
        workflowObj: { name: "wf", steps: [], trigger: { type: "schedule" } },
      })
      const matches = analyzer.detectPatterns(t)
      expect(matches.some((m) => m.pattern === "schedule_trigger")).toBe(true)
    })

    it("detects has_onfailure_handling", () => {
      const t = makeTemplate({
        workflowObj: {
          name: "wf",
          steps: [{ id: "s1", type: "http", onFailure: { retry: {} } }],
          trigger: { type: "manual" },
        },
      })
      const matches = analyzer.detectPatterns(t)
      expect(matches.some((m) => m.pattern === "has_onfailure_handling")).toBe(true)
    })

    it("detects has_retry_config", () => {
      const t = makeTemplate({
        workflowObj: {
          name: "wf",
          steps: [{ id: "s1", type: "http", onFailure: { retry: { maxAttempts: 3 } } }],
          trigger: { type: "manual" },
        },
      })
      const matches = analyzer.detectPatterns(t)
      expect(matches.some((m) => m.pattern === "has_retry_config")).toBe(true)
    })

    it("detects dynamic_name", () => {
      const t = makeTemplate({
        metadata: { id: "tpl-dyn", name: "{{ param:name }}", description: "", category: "", tags: [], templateVersion: "1.0.0", author: "", parameters: [], requires: [], source: "builtin" },
        workflowObj: { name: "{{ param:name }}", steps: [], trigger: { type: "manual" } },
      })
      const matches = analyzer.detectPatterns(t)
      expect(matches.some((m) => m.pattern === "dynamic_name")).toBe(true)
    })

    it("detects parameterized", () => {
      const t = makeTemplate({
        metadata: { id: "tpl-param", name: "Test", description: "", category: "", tags: [], templateVersion: "1.0.0", author: "", parameters: [{ name: "url", label: "URL", type: "string" }], requires: [], source: "builtin" },
      })
      const matches = analyzer.detectPatterns(t)
      expect(matches.some((m) => m.pattern === "parameterized")).toBe(true)
    })

    it("does not match pattern for single step without chaining", () => {
      const t = makeTemplate({
        workflowObj: { name: "wf", steps: [{ id: "s1", type: "http" }], trigger: { type: "manual" } },
      })
      const matches = analyzer.detectPatterns(t)
      expect(matches.some((m) => m.pattern === "multi_step_chain")).toBe(false)
      expect(matches.some((m) => m.pattern === "http_llm_chain")).toBe(false)
    })

    it("returns label for single_step", () => {
      const t = makeTemplate({
        workflowObj: { name: "wf", steps: [{ id: "s1", type: "http" }], trigger: { type: "manual" } },
      })
      const matches = analyzer.detectPatterns(t)
      const m = matches.find((x) => x.pattern === "single_step")
      expect(m?.label).toBe("Single step")
    })
  })
})
