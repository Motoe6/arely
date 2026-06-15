import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { TemplateRegistry } from "@arelyos/engine/templates/template-registry.js"
import { globalNodeRegistry, HttpNode, LLMNode } from "@arelyos/flow-sdk"
import type { Template } from "@arelyos/engine/templates/template-types.js"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const FIXTURES_DIR = join(__dirname, "..", "..", "tests", "fixtures", "test-templates")

beforeAll(() => {
  try { globalNodeRegistry.register(HttpNode) } catch { /* ok */ }
  try { globalNodeRegistry.register(LLMNode) } catch { /* ok */ }
})

afterAll(() => {
  globalNodeRegistry.unregister("http")
  globalNodeRegistry.unregister("llm")
})

function makeTemplate(id: string): Template {
  return {
    metadata: {
      id,
      name: `Template ${id}`,
      description: `Description for ${id}`,
      category: "test-category",
      tags: ["test"],
      templateVersion: "1.0.0",
      author: "Test",
      parameters: [],
      requires: [],
      source: "builtin",
    },
    workflowDsl: `version: "1.0.0"\nsteps:\n  - id: s1\n    type: llm\n    input:\n      prompt: hello`,
    workflowObj: {
      version: "1.0.0",
      steps: [{ id: "s1", type: "llm", input: { prompt: "hello" } }],
    },
  }
}

function makeParamTemplate(id: string): Template {
  return {
    metadata: {
      id,
      name: "Param Template",
      description: "Template with parameters",
      category: "params",
      tags: ["params", "test"],
      templateVersion: "2.0.0",
      author: "Test",
      parameters: [
        { name: "name", label: "Name", type: "string", required: true },
        { name: "count", label: "Count", type: "number", required: false, default: 42 },
        { name: "enabled", label: "Enabled", type: "boolean", required: false, default: true },
        { name: "metadata", label: "Metadata", type: "json", required: false, default: { key: "val" } },
      ],
      requires: ["llm"],
      source: "builtin",
    },
    workflowDsl: `version: "1.0.0"\nname: "{{ param:name }}"\nsteps:\n  - id: s1\n    type: llm\n    input:\n      prompt: "{{ param:name }}"\n      count: "{{ param:count }}"\n      enabled: "{{ param:enabled }}"\n      meta: "{{ param:metadata }}"`,
    workflowObj: {
      version: "1.0.0",
      name: "{{ param:name }}",
      steps: [
        {
          id: "s1",
          type: "llm",
          input: {
            prompt: "{{ param:name }}",
            count: "{{ param:count }}",
            enabled: "{{ param:enabled }}",
            meta: "{{ param:metadata }}",
          },
        },
      ],
    },
  }
}

describe("TemplateRegistry", () => {
  describe("register + get", () => {
    it("registers and retrieves a template", () => {
      const reg = new TemplateRegistry()
      const t = makeTemplate("reg-test-1")
      reg.registerInline(t)
      const got = reg.get("reg-test-1")
      expect(got).toBeDefined()
      expect(got!.metadata.id).toBe("reg-test-1")
      expect(got!.metadata.name).toBe("Template reg-test-1")
    })

    it("returns undefined for unknown template", () => {
      const reg = new TemplateRegistry()
      expect(reg.get("nonexistent")).toBeUndefined()
    })

    it("throws on duplicate registration", () => {
      const reg = new TemplateRegistry()
      reg.registerInline(makeTemplate("dup-test"))
      expect(() => reg.registerInline(makeTemplate("dup-test"))).toThrow(/already registered/)
    })

    it("unregisterTemplate removes a template", () => {
      const reg = new TemplateRegistry()
      reg.registerInline(makeTemplate("unreg-test"))
      expect(reg.get("unreg-test")).toBeDefined()
      const removed = reg.unregisterTemplate("unreg-test")
      expect(removed).toBe(true)
      expect(reg.get("unreg-test")).toBeUndefined()
    })

    it("unregisterTemplate returns false for nonexistent id", () => {
      const reg = new TemplateRegistry()
      expect(reg.unregisterTemplate("no-such")).toBe(false)
    })
  })

  describe("list + search", () => {
    it("lists all templates", () => {
      const reg = new TemplateRegistry()
      reg.registerInline(makeTemplate("list-1"))
      reg.registerInline(makeTemplate("list-2"))
      const all = reg.list()
      expect(all).toHaveLength(2)
    })

    it("filters by category", () => {
      const reg = new TemplateRegistry()
      const t1 = makeTemplate("cat-1")
      t1.metadata.category = "alpha"
      const t2 = makeTemplate("cat-2")
      t2.metadata.category = "beta"
      reg.registerInline(t1)
      reg.registerInline(t2)
      expect(reg.list("alpha")).toHaveLength(1)
      expect(reg.list("beta")).toHaveLength(1)
      expect(reg.list("gamma")).toHaveLength(0)
    })

    it("searches by tag", () => {
      const reg = new TemplateRegistry()
      const t1 = makeTemplate("tag-1")
      t1.metadata.tags = ["foo"]
      const t2 = makeTemplate("tag-2")
      t2.metadata.tags = ["bar"]
      reg.registerInline(t1)
      reg.registerInline(t2)
      expect(reg.search("foo")).toHaveLength(1)
      expect(reg.search("bar")).toHaveLength(1)
      expect(reg.search("baz")).toHaveLength(0)
    })

    it("search without tag returns all", () => {
      const reg = new TemplateRegistry()
      reg.registerInline(makeTemplate("s-all-1"))
      reg.registerInline(makeTemplate("s-all-2"))
      expect(reg.search()).toHaveLength(2)
    })

    it("listCategories returns sorted unique categories", () => {
      const reg = new TemplateRegistry()
      const t1 = makeTemplate("lc-1")
      t1.metadata.category = "zeta"
      const t2 = makeTemplate("lc-2")
      t2.metadata.category = "alpha"
      const t3 = makeTemplate("lc-3")
      t3.metadata.category = "zeta"
      reg.registerInline(t1)
      reg.registerInline(t2)
      reg.registerInline(t3)
      expect(reg.listCategories()).toEqual(["alpha", "zeta"])
    })
  })

  describe("registerTemplate (filesystem)", () => {
    it("loads from a valid template directory", () => {
      const reg = new TemplateRegistry()
      reg.registerTemplate(join(FIXTURES_DIR, "test-template"))
      const t = reg.get("test-fixture")
      expect(t).toBeDefined()
      expect(t!.metadata.id).toBe("test-fixture")
      expect(t!.metadata.category).toBe("testing")
      expect(t!.metadata.tags).toContain("http")
      expect(t!.metadata.requires).toContain("http")
      expect(t!.workflowDsl).toContain("target_url")
      expect(t!.workflowObj).toBeDefined()
    })

    it("throws for nonexistent directory", () => {
      const reg = new TemplateRegistry()
      expect(() => reg.registerTemplate(join(FIXTURES_DIR, "nonexistent"))).toThrow()
    })
  })

  describe("reloadBuiltins", () => {
    it("loads all valid template directories", () => {
      const reg = new TemplateRegistry()
      const count = reg.reloadBuiltins(FIXTURES_DIR)
      expect(count).toBeGreaterThanOrEqual(1)
      expect(reg.get("test-fixture")).toBeDefined()
    })

    it("returns 0 for nonexistent directory", () => {
      const reg = new TemplateRegistry()
      const count = reg.reloadBuiltins(join(FIXTURES_DIR, "empty-dir"))
      expect(count).toBe(0)
    })
  })

  describe("instantiate", () => {
    it("returns a valid workflow with all params applied", () => {
      const reg = new TemplateRegistry()
      reg.registerInline(makeParamTemplate("inst-1"))
      const result = reg.instantiate("inst-1", {
        name: "test-workflow",
        count: 99,
        enabled: false,
        metadata: { foo: "bar", num: 1 },
      })
      expect(result.workflow).toBeDefined()
      expect(result.workflow.id).toBeTruthy()
      expect(result.workflow.name).toBe("test-workflow")
      expect(result.workflow.steps).toHaveLength(1)

      const step = result.workflow.steps[0]
      expect(step.input!.prompt).toBe("test-workflow")
      expect(step.input!.count).toBe(99)
      expect(step.input!.enabled).toBe(false)
      expect(step.input!.meta).toEqual({ foo: "bar", num: 1 })
    })

    it("applies default values for missing optional params", () => {
      const reg = new TemplateRegistry()
      reg.registerInline(makeParamTemplate("inst-2"))
      const result = reg.instantiate("inst-2", { name: "defaults-test" })
      expect(result.workflow.name).toBe("defaults-test")

      const step = result.workflow.steps[0]
      expect(step.input!.count).toBe(42)
      expect(step.input!.enabled).toBe(true)
      expect(step.input!.meta).toEqual({ key: "val" })
    })

    it("throws if required param is missing", () => {
      const reg = new TemplateRegistry()
      reg.registerInline(makeParamTemplate("inst-3"))
      expect(() => reg.instantiate("inst-3", {})).toThrow(/required/)
    })

    it("throws for unknown template", () => {
      const reg = new TemplateRegistry()
      expect(() => reg.instantiate("no-such-template", {})).toThrow(/not found/)
    })

    it("throws on type mismatch for string param", () => {
      const reg = new TemplateRegistry()
      reg.registerInline(makeParamTemplate("inst-4"))
      expect(() => reg.instantiate("inst-4", { name: 123 })).toThrow(/must be a string/)
    })

    it("throws on type mismatch for number param", () => {
      const reg = new TemplateRegistry()
      reg.registerInline(makeParamTemplate("inst-5"))
      expect(() => reg.instantiate("inst-5", { name: "x", count: "not-a-number" })).toThrow(/must be a number/)
    })

    it("throws on type mismatch for boolean param", () => {
      const reg = new TemplateRegistry()
      reg.registerInline(makeParamTemplate("inst-6"))
      expect(() => reg.instantiate("inst-6", { name: "x", enabled: "yes" })).toThrow(/must be a boolean/)
    })

    it("injects workflow.metadata.template", () => {
      const reg = new TemplateRegistry()
      reg.registerInline(makeParamTemplate("inst-meta"))
      const result = reg.instantiate("inst-meta", { name: "meta-test" })
      expect(result.workflow.metadata).toBeDefined()
      expect(result.workflow.metadata!.template).toBeDefined()
      expect(result.workflow.metadata!.template).toEqual({
        id: "inst-meta",
        version: "2.0.0",
      })
      expect(result.metadata.templateId).toBe("inst-meta")
      expect(result.metadata.templateVersion).toBe("2.0.0")
    })

    it("throws if a required node type is not registered", () => {
      const reg = new TemplateRegistry()
      const t = makeParamTemplate("inst-node-check")
      t.metadata.requires = ["nonexistent-node"]
      reg.registerInline(t)
      expect(() => reg.instantiate("inst-node-check", { name: "x" })).toThrow(
        /requires node type/
      )
    })

    it("uses custom workflowIdGenerator when provided", () => {
      const reg = new TemplateRegistry()
      reg.registerInline(makeParamTemplate("inst-id-gen"))
      const result = reg.instantiate("inst-id-gen", { name: "x" }, {
        workflowIdGenerator: () => "custom-id-001",
      })
      expect(result.workflow.id).toBe("custom-id-001")
    })

    it("does not mutate the original template", () => {
      const reg = new TemplateRegistry()
      reg.registerInline(makeParamTemplate("inst-no-mutate"))
      const original = reg.get("inst-no-mutate")
      const originalObj = JSON.stringify(original!.workflowObj)

      reg.instantiate("inst-no-mutate", { name: "mutate-test" })

      const after = reg.get("inst-no-mutate")
      expect(JSON.stringify(after!.workflowObj)).toBe(originalObj)
    })

    it("is idempotent with same params + fixed ID", () => {
      const reg = new TemplateRegistry()
      reg.registerInline(makeParamTemplate("inst-idem"))
      const gen = () => "fixed-id"

      const a = reg.instantiate("inst-idem", { name: "same" }, { workflowIdGenerator: gen })
      const b = reg.instantiate("inst-idem", { name: "same" }, { workflowIdGenerator: gen })

      expect(a.workflow).toEqual(b.workflow)
    })
  })

  describe("built-in templates", () => {
    const BUILTIN_DIR = join(__dirname, "..", "..", "packages", "engine", "templates")

    it("loads all 7 built-in templates", () => {
      const reg = new TemplateRegistry()
      reg.reloadBuiltins(BUILTIN_DIR)
      expect(reg.list()).toHaveLength(7)
      for (const id of ["webhook-relay", "http-webhook-proxy", "scheduled-health-check", "api-chain", "llm-query", "webhook-llm-responder", "scheduled-monitor-analysis"]) {
        expect(reg.get(id)).toBeDefined()
      }
    })

    it("every built-in template directory has metadata.json, template.yaml, and README.md", () => {
      const reg = new TemplateRegistry()
      reg.reloadBuiltins(BUILTIN_DIR)
      const ids = reg.list().map((m) => m.id)
      for (const id of ids) {
        const dir = join(BUILTIN_DIR, id)
        expect(require("fs").existsSync(join(dir, "metadata.json"))).toBe(true)
        expect(require("fs").existsSync(join(dir, "template.yaml"))).toBe(true)
        expect(require("fs").existsSync(join(dir, "README.md"))).toBe(true)
      }
    })

    it("requires[] matches step types used in each template", () => {
      const reg = new TemplateRegistry()
      reg.reloadBuiltins(BUILTIN_DIR)
      for (const t of reg.list()) {
        const template = reg.get(t.id)!
        const stepTypes = new Set<string>()
        const obj = template.workflowObj as Record<string, unknown>
        const steps = obj.steps as Array<Record<string, unknown>>
        for (const step of steps) {
          stepTypes.add(step.type as string)
        }
        for (const stepType of stepTypes) {
          expect(t.requires).toContain(stepType)
        }
      }
    })

    it.each([
      ["webhook-relay", { target_url: "https://example.com/hook" }],
      ["http-webhook-proxy", { target_url: "https://example.com/proxy" }],
      ["scheduled-health-check", { target_url: "https://example.com/health" }],
      ["api-chain", { first_url: "https://a.com/1", second_url: "https://b.com/2" }],
      ["llm-query", { prompt_template: "Hello" }],
      ["webhook-llm-responder", { system_prompt: "Analyze" }],
      ["scheduled-monitor-analysis", { target_url: "https://m.com/data", analysis_prompt: "Summarize" }],
    ])("instantiates template %s with minimal params", (id, params) => {
      const reg = new TemplateRegistry()
      reg.reloadBuiltins(BUILTIN_DIR)
      const result = reg.instantiate(id, params)
      expect(result.workflow).toBeDefined()
      expect(result.workflow.steps.length).toBeGreaterThan(0)
      expect(result.workflow.metadata?.template).toBeDefined()
      const json = JSON.stringify(result.workflow)
      expect(json).not.toContain("{{param:")
    })

    it("template requiring llm fails when llm not installed", () => {
      const reg = new TemplateRegistry()
      reg.reloadBuiltins(BUILTIN_DIR)
      const noLlm = { has: (t: string) => t !== "llm", list: () => [{ type: "http" }] }
      expect(() => reg.instantiate("llm-query", { prompt_template: "x" }, { registry: noLlm as never }))
        .toThrow(/requires node type/)
      expect(() => reg.instantiate("scheduled-monitor-analysis", { target_url: "https://x.com", analysis_prompt: "x" }, { registry: noLlm as never }))
        .toThrow(/requires node type/)
    })
  })
})
