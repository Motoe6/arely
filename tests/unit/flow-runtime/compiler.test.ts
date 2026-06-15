import { describe, it, expect } from "vitest"
import { compileWorkflow, parseWorkflow, mapTrigger } from "@arely/flow-runtime"
import type { ExecutionContext, Workflow } from "@arely/flow-runtime"

function makeContext(): ExecutionContext {
  return {
    trigger: { payload: { user: { id: "u1", name: "Alice" } } },
    steps: new Map(),
    secrets: new Map([["api_key", "sk-123"]]),
  }
}

const simpleJSON = `{
  "id": "wf-test",
  "version": "1.0.0",
  "steps": [
    { "id": "fetch", "type": "http.request", "input": { "url": "{{ secrets.api_key }}" } },
    { "id": "process", "type": "transform", "input": { "name": "{{ trigger.payload.user.name }}" }, "next": "save" },
    { "id": "save", "type": "db.write", "input": {} }
  ],
  "trigger": { "type": "webhook" }
}`

describe("compileWorkflow", () => {
  it("compiles a valid workflow to pipeline", () => {
    const wf = parseWorkflow(simpleJSON, "json")
    const result = compileWorkflow(wf, makeContext())

    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
    expect(result.pipeline.name).toBe("wf-test")
    expect(result.pipeline.steps).toHaveLength(3)
  })

  it("resolves templates in step input", () => {
    const wf = parseWorkflow(simpleJSON, "json")
    const result = compileWorkflow(wf, makeContext())

    const fetchStep = result.pipeline.steps.find((s) => s.id === "fetch")
    expect(fetchStep).toBeDefined()
    const input = JSON.parse(fetchStep!.inputMapping)
    expect(input.url).toBe("sk-123")
  })

  it("resolves trigger payload templates", () => {
    const wf = parseWorkflow(simpleJSON, "json")
    const result = compileWorkflow(wf, makeContext())

    const processStep = result.pipeline.steps.find((s) => s.id === "process")
    expect(processStep).toBeDefined()
    const input = JSON.parse(processStep!.inputMapping)
    expect(input.name).toBe("Alice")
  })

  it("computes dependsOn from implicit ordering (first step depends on nothing)", () => {
    const wf = parseWorkflow(simpleJSON, "json")
    const result = compileWorkflow(wf, makeContext())

    const fetchStep = result.pipeline.steps.find((s) => s.id === "fetch")
    expect(fetchStep!.dependsOn).toEqual([])
  })

  it("computes dependsOn from implicit ordering (previous step)", () => {
    const wf = parseWorkflow(simpleJSON, "json")
    const result = compileWorkflow(wf, makeContext())

    const processStep = result.pipeline.steps.find((s) => s.id === "process")
    expect(processStep!.dependsOn).toEqual(["fetch"])
  })

  it("computes dependsOn from next field adds dep to target", () => {
    const wf = parseWorkflow(simpleJSON, "json")
    const result = compileWorkflow(wf, makeContext())

    const saveStep = result.pipeline.steps.find((s) => s.id === "save")
    expect(saveStep!.dependsOn).toContain("process")
  })

  it("sets stepOrder correctly", () => {
    const wf = parseWorkflow(simpleJSON, "json")
    const result = compileWorkflow(wf, makeContext())

    expect(result.pipeline.steps[0].stepOrder).toBe(0)
    expect(result.pipeline.steps[1].stepOrder).toBe(1)
    expect(result.pipeline.steps[2].stepOrder).toBe(2)
  })

  it("propagates retry config from onFailure", () => {
    const input = JSON.stringify({
      id: "wf-retry",
      version: "1.0.0",
      steps: [
        {
          id: "fetch",
          type: "http.request",
          input: {},
          onFailure: { retry: { maxAttempts: 3, delayMs: 2000 } },
        },
      ],
    })
    const wf = parseWorkflow(input, "json")
    const result = compileWorkflow(wf, makeContext())

    expect(result.errors).toHaveLength(0)
    expect(result.pipeline.steps[0].retries).toBe(3)
    expect(result.pipeline.steps[0].retryDelayMs).toBe(2000)
  })

  it("reports DAG cycle errors", () => {
    const input = JSON.stringify({
      id: "wf-cycle",
      version: "1.0.0",
      steps: [
        { id: "a", type: "log", input: {}, next: "b" },
        { id: "b", type: "log", input: {}, next: "a" },
      ],
    })
    const wf = parseWorkflow(input, "json")
    const result = compileWorkflow(wf, makeContext())

    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.some((e) => e.message.includes("Cycle"))).toBe(true)
    expect(result.pipeline.steps).toHaveLength(2)
  })

  it("reports missing reference errors", () => {
    const input = JSON.stringify({
      id: "wf-miss",
      version: "1.0.0",
      steps: [
        { id: "a", type: "http.request", input: {}, next: "nonexistent" },
      ],
    })
    const wf = parseWorkflow(input, "json")
    const result = compileWorkflow(wf, makeContext())

    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.some((e) => e.message.includes("references undefined step"))).toBe(true)
  })

  it("warns on unreachable steps", () => {
    const input = JSON.stringify({
      id: "wf-unreachable",
      version: "1.0.0",
      steps: [
        { id: "start", type: "http.request", input: {}, next: "end" },
        { id: "orphan", type: "log", input: {} },
        { id: "end", type: "log", input: {} },
      ],
    })
    const wf = parseWorkflow(input, "json")
    const result = compileWorkflow(wf, makeContext())

    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.some((w) => w.message.includes("unreachable"))).toBe(true)
  })

  it("converts step references to F30 {{stepId}} format (no errors)", () => {
    const input = JSON.stringify({
      id: "wf-tpl",
      version: "1.0.0",
      steps: [
        { id: "s1", type: "step1_tool", input: { val: "initial" } },
        { id: "s2", type: "step2_tool", input: { ref: "{{ steps.s1.output }}" } },
      ],
    })
    const wf = parseWorkflow(input, "json")
    const result = compileWorkflow(wf, makeContext())

    expect(result.errors).toHaveLength(0)
    const s2Input = JSON.parse(result.pipeline.steps.find((s) => s.id === "s2")!.inputMapping)
    expect(s2Input.ref).toBe("{{s1}}")
  })

  it("continues on non-step-template errors — other steps still compiled", () => {
    const input = JSON.stringify({
      id: "wf-partial",
      version: "1.0.0",
      steps: [
        { id: "good", type: "log", input: { msg: "hello" } },
        { id: "bad", type: "log", input: { val: "{{ secrets.missing_key }}" } },
        { id: "also_good", type: "log", input: { msg: "world" } },
      ],
    })
    const wf = parseWorkflow(input, "json")
    const result = compileWorkflow(wf, makeContext())

    expect(result.errors.length).toBeGreaterThan(0)
    const stepIds = result.pipeline.steps.map((s) => s.id)
    expect(stepIds).toContain("good")
    expect(stepIds).not.toContain("bad")
    expect(stepIds).toContain("also_good")
  })

  it("propagates template errors for non-step references", () => {
    const input = JSON.stringify({
      id: "wf-partial",
      version: "1.0.0",
      steps: [
        { id: "s1", type: "log", input: { val: "{{ secrets.missing }}" } },
      ],
    })
    const wf = parseWorkflow(input, "json")
    const result = compileWorkflow(wf, makeContext())
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("assigns default stepOrder based on array index", () => {
    const wf = parseWorkflow(simpleJSON, "json")
    const result = compileWorkflow(wf, makeContext())

    result.pipeline.steps.forEach((step, i) => {
      expect(step.stepOrder).toBe(i)
    })
  })

  it("produces deterministic output for same input", () => {
    const wf = parseWorkflow(simpleJSON, "json")
    const ctx = makeContext()

    const results = Array.from({ length: 5 }, () => compileWorkflow(wf, ctx))
    const first = results[0].pipeline.steps.map((s) => s.inputMapping)
    for (const r of results.slice(1)) {
      const mappings = r.pipeline.steps.map((s) => s.inputMapping)
      expect(mappings).toEqual(first)
    }
  })
})

describe("mapTrigger", () => {
  it("maps webhook trigger", () => {
    const result = mapTrigger({ type: "webhook", config: { method: "POST" } })
    expect(result).toEqual({ type: "event", source: "http", config: { method: "POST" } })
  })

  it("maps interval trigger", () => {
    const result = mapTrigger({ type: "interval", config: { intervalMs: 60000 } })
    expect(result).toEqual({ type: "event", source: "cron", config: { intervalMs: 60000 } })
  })

  it("maps manual trigger", () => {
    const result = mapTrigger({ type: "manual" })
    expect(result).toEqual({ type: "event", source: "manual", config: undefined })
  })

  it("maps event trigger", () => {
    const result = mapTrigger({ type: "event", config: { name: "order.placed" } })
    expect(result).toEqual({ type: "event", source: "event", config: { name: "order.placed" } })
  })

  it("returns undefined for missing trigger", () => {
    expect(mapTrigger(undefined)).toBeUndefined()
  })
})
