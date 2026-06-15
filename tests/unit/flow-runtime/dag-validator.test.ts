import { describe, it, expect } from "vitest"
import { validateDAG } from "@arely/flow-runtime"
import type { Workflow } from "@arely/flow-runtime"

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "test-workflow",
    version: "1.0.0",
    steps: [
      { id: "start", type: "http.request", input: { url: "https://example.com" } },
      { id: "process", type: "transform", input: {}, next: "end" },
      { id: "end", type: "log", input: {} },
    ],
    ...overrides,
  }
}

describe("validateDAG", () => {
  it("accepts valid linear workflow", () => {
    const result = validateDAG(makeWorkflow())
    expect(result.valid).toBe(true)
    expect(result.cycles).toHaveLength(0)
    expect(result.missingReferences).toHaveLength(0)
    expect(result.selfReferences).toHaveLength(0)
  })

  it("accepts workflow with branching (multiple next)", () => {
    const wf = makeWorkflow({
      steps: [
        { id: "start", type: "http.request", input: {}, next: ["process_a", "process_b"] },
        { id: "process_a", type: "transform", input: {}, next: "end" },
        { id: "process_b", type: "transform", input: {}, next: "end" },
        { id: "end", type: "log", input: {} },
      ],
    })
    const result = validateDAG(wf)
    expect(result.valid).toBe(true)
  })

  it("rejects simple cycle (A → B → A)", () => {
    const wf = makeWorkflow({
      steps: [
        { id: "a", type: "http.request", input: {}, next: "b" },
        { id: "b", type: "transform", input: {}, next: "a" },
      ],
    })
    const result = validateDAG(wf)
    expect(result.valid).toBe(false)
    expect(result.cycles.length).toBeGreaterThan(0)
    const cycle = result.cycles[0]
    expect(cycle).toContain("a")
    expect(cycle).toContain("b")
  })

  it("rejects self-referencing step", () => {
    const wf = makeWorkflow({
      steps: [
        { id: "a", type: "http.request", input: {}, next: "a" },
      ],
    })
    const result = validateDAG(wf)
    expect(result.valid).toBe(false)
    expect(result.selfReferences).toContain("a")
  })

  it("rejects reference to undefined step", () => {
    const wf = makeWorkflow({
      steps: [
        { id: "start", type: "http.request", input: {}, next: "nonexistent" },
      ],
    })
    const result = validateDAG(wf)
    expect(result.valid).toBe(false)
    expect(result.missingReferences).toHaveLength(1)
    expect(result.missingReferences[0]).toEqual({
      from: "start",
      ref: "nonexistent",
      kind: "next",
    })
  })

  it("detects fallback references to undefined steps", () => {
    const wf = makeWorkflow({
      steps: [
        {
          id: "start",
          type: "http.request",
          input: {},
          onFailure: { fallback: "missing_fallback" },
        },
      ],
    })
    const result = validateDAG(wf)
    expect(result.valid).toBe(false)
    expect(result.missingReferences).toHaveLength(1)
    expect(result.missingReferences[0].kind).toBe("fallback")
  })

  it("detects unreachable steps", () => {
    const wf = makeWorkflow({
      steps: [
        { id: "start", type: "http.request", input: {}, next: "end" },
        { id: "orphan", type: "transform", input: {} },
        { id: "end", type: "log", input: {} },
      ],
    })
    const result = validateDAG(wf)
    expect(result.unreachableSteps).toContain("orphan")
  })

  it("accepts empty workflow (no steps)", () => {
    const wf = makeWorkflow({ steps: [] })
    const result = validateDAG(wf)
    expect(result.valid).toBe(true)
  })

  it("accepts single step workflow", () => {
    const wf = makeWorkflow({ steps: [{ id: "only", type: "log", input: {} }] })
    const result = validateDAG(wf)
    expect(result.valid).toBe(true)
    expect(result.unreachableSteps).toHaveLength(0)
  })

  it("detects complex cycle in longer graph", () => {
    const wf = makeWorkflow({
      steps: [
        { id: "a", type: "http.request", input: {}, next: "b" },
        { id: "b", type: "transform", input: {}, next: "c" },
        { id: "c", type: "transform", input: {}, next: "d" },
        { id: "d", type: "log", input: {}, next: "b" },
      ],
    })
    const result = validateDAG(wf)
    expect(result.valid).toBe(false)
    expect(result.cycles.length).toBeGreaterThan(0)
  })
})
