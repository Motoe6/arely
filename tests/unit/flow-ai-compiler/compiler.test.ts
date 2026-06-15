import { describe, it, expect, beforeEach } from "vitest"
import { compilePrompt, processLLMOutput, buildPrompt, validateWorkflow, assertValidWorkflow, FEW_SHOT_EXAMPLES, AICompilerError } from "@arelyos/flow-ai-compiler"
import { globalNodeRegistry, LLMNode, HttpNode } from "@arelyos/flow-sdk"
import type { LLMAdapter } from "@arelyos/flow-ai-compiler"

describe("Flow AI Compiler", () => {
  beforeEach(() => {
    // Ensure known node types are registered for tests
    if (!globalNodeRegistry.has("llm")) globalNodeRegistry.register(LLMNode)
    if (!globalNodeRegistry.has("http")) globalNodeRegistry.register(HttpNode)
  })

  describe("schema validation", () => {
    it("accepts a valid workflow", () => {
      const wf = {
        id: "test-workflow",
        version: "1.0.0",
        trigger: { type: "webhook", config: { path: "/test" } },
        steps: [{ id: "s1", type: "log", input: { msg: "hello" } }],
      }
      expect(() => assertValidWorkflow(wf)).not.toThrow()
    })

    it("rejects missing id", () => {
      expect(() => assertValidWorkflow({ version: "1.0.0", steps: [] })).toThrow("must have a non-empty string id")
    })

    it("rejects empty steps array", () => {
      expect(() =>
        assertValidWorkflow({ id: "x", version: "1.0.0", steps: [] }),
      ).toThrow("at least one step")
    })

    it("rejects unknown step fields", () => {
      const wf = {
        id: "x",
        version: "1.0.0",
        steps: [{ id: "s1", type: "log", input: {}, randomField: true }],
      }
      expect(() => assertValidWorkflow(wf)).toThrow("unknown field")
    })

    it("rejects invalid trigger type", () => {
      const wf = {
        id: "x",
        version: "1.0.0",
        trigger: { type: "invalid_trigger" },
        steps: [{ id: "s1", type: "log", input: {} }],
      }
      expect(() => assertValidWorkflow(wf)).toThrow("Invalid trigger type")
    })

    it("rejects non-string next in array", () => {
      const wf = {
        id: "x",
        version: "1.0.0",
        steps: [{ id: "s1", type: "log", input: {}, next: [42] }],
      }
      expect(() => assertValidWorkflow(wf)).toThrow("next array must contain only strings")
    })
  })

  describe("buildPrompt", () => {
    it("includes the user request in the prompt", () => {
      const prompt = buildPrompt("send email when user signs up")
      expect(prompt).toContain("send email when user signs up")
    })

    it("includes the DSL schema spec", () => {
      const prompt = buildPrompt("test")
      expect(prompt).toContain("AVAILABLE NODE TYPES")
      expect(prompt).toContain("DSL SCHEMA")
    })

    it("includes few-shot examples by default", () => {
      const prompt = buildPrompt("test")
      expect(prompt).toContain(FEW_SHOT_EXAMPLES[0].input)
    })
  })

  describe("processLLMOutput", () => {
    it("processes valid LLM output", async () => {
      const result = await processLLMOutput({
        workflow: {
          id: "simple",
          version: "1.0.0",
          trigger: { type: "manual" },
          steps: [{ id: "s1", type: "llm", input: { prompt: "hello" } }],
        },
        confidence: 0.95,
        assumptions: ["test"],
      })
      expect(result.workflow.id).toBe("simple")
      expect(result.confidence).toBe(0.95)
      expect(result.assumptions).toEqual(["test"])
    })

    it("throws on missing workflow field", async () => {
      await expect(processLLMOutput({})).rejects.toThrow("must contain a 'workflow' field")
    })

    it("throws on unknown node type", async () => {
      await expect(
        processLLMOutput({
          workflow: {
            id: "x",
            version: "1.0.0",
            steps: [{ id: "s1", type: "unknown_node_type", input: {} }],
          },
        }),
      ).rejects.toThrow("unknown node type")
    })

    it("guesses workflow from non-standard output with steps array", async () => {
      const result = await processLLMOutput({
        id: "inferred",
        version: "1.0.0",
        steps: [{ id: "s1", type: "llm", input: { prompt: "hi" } }],
      })
      expect(result.workflow.id).toBe("inferred")
      expect(result.confidence).toBe(0.5)
    })
  })

  describe("validateWorkflow", () => {
    it("validates a correct workflow", () => {
      const result = validateWorkflow({
        id: "x",
        version: "1.0.0",
        steps: [{ id: "s1", type: "llm", input: {} }],
      })
      expect(result.valid).toBe(true)
    })

    it("rejects unknown node types", () => {
      const result = validateWorkflow({
        id: "x",
        version: "1.0.0",
        steps: [{ id: "s1", type: "nonexistent", input: {} }],
      })
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain("nonexistent")
    })

    it("detects cycles via DAG validator", () => {
      const result = validateWorkflow({
        id: "x",
        version: "1.0.0",
        steps: [
          { id: "a", type: "llm", input: {}, next: "b" },
          { id: "b", type: "http", input: {}, next: "a" },
        ],
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("Cycle"))).toBe(true)
    })
  })

  describe("compilePrompt (without real LLM)", () => {
    it("throws when LLM stub returns invalid JSON", async () => {
      const stub: LLMAdapter = { generateStructured: async () => "not json" }
      await expect(compilePrompt("test", { llm: stub })).rejects.toThrow()
    })

    it("processes a valid stub workflow", async () => {
      const stub: LLMAdapter = {
        generateStructured: async () => ({
          workflow: {
            id: "stub-workflow",
            version: "1.0.0",
            trigger: { type: "manual" },
            steps: [{ id: "s1", type: "llm", input: { prompt: "summarize" } }],
          },
          confidence: 0.9,
          assumptions: [],
        }),
      }
      const result = await compilePrompt("summarize data", { llm: stub })
      expect(result.workflow.id).toBe("stub-workflow")
      expect(result.workflow.steps).toHaveLength(1)
    })
  })

  describe("few-shot examples", () => {
    it("has valid workflow structures in all examples", () => {
      for (const ex of FEW_SHOT_EXAMPLES) {
        expect(() => assertValidWorkflow(ex.output.workflow)).not.toThrow()
      }
    })
  })
})
