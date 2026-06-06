import { describe, it, expect } from "vitest"
import { parseWorkflow } from "@opencode/flow-runtime"
import { CompilationError } from "@opencode/flow-runtime"

const validJSON = `{
  "id": "wf-1",
  "version": "1.0.0",
  "name": "test",
  "steps": [
    { "id": "fetch", "type": "http.request", "input": { "url": "https://example.com" } },
    { "id": "process", "type": "transform", "input": {}, "next": "save" },
    { "id": "save", "type": "db.write", "input": {} }
  ],
  "trigger": { "type": "webhook", "config": { "method": "POST" } }
}`

const validYAML = `id: wf-2
version: "1.0.0"
name: yaml workflow
steps:
  - id: fetch
    type: http.request
    input:
      url: https://example.com
  - id: process
    type: transform
    input: {}
    next: save
  - id: save
    type: db.write
    input: {}
trigger:
  type: webhook
  config:
    method: POST
`

describe("parseWorkflow — JSON", () => {
  it("parses valid JSON workflow", () => {
    const wf = parseWorkflow(validJSON, "json")
    expect(wf.id).toBe("wf-1")
    expect(wf.version).toBe("1.0.0")
    expect(wf.steps).toHaveLength(3)
    expect(wf.steps[0].id).toBe("fetch")
    expect(wf.steps[0].type).toBe("http.request")
  })

  it("generates ULID if no id provided", () => {
    const input = JSON.stringify({ steps: [{ id: "s1", type: "log", input: {} }] })
    const wf = parseWorkflow(input, "json")
    expect(wf.id).toBeDefined()
    expect(typeof wf.id).toBe("string")
    expect(wf.version).toBe("1.0.0")
  })

  it("defaults version to 1.0.0 if not provided", () => {
    const input = JSON.stringify({ id: "x", steps: [{ id: "s1", type: "log", input: {} }] })
    const wf = parseWorkflow(input, "json")
    expect(wf.version).toBe("1.0.0")
  })

  it("rejects invalid JSON", () => {
    expect(() => parseWorkflow("not json", "json")).toThrow(CompilationError)
  })

  it("rejects non-object JSON", () => {
    expect(() => parseWorkflow("[]", "json")).toThrow(CompilationError)
    expect(() => parseWorkflow('"string"', "json")).toThrow(CompilationError)
  })

  it("rejects missing steps", () => {
    expect(() => parseWorkflow('{"id":"x"}', "json")).toThrow(CompilationError)
  })

  it("rejects steps that is not an array", () => {
    expect(() => parseWorkflow('{"id":"x","steps":"not array"}', "json")).toThrow(CompilationError)
  })

  it("rejects step without id", () => {
    expect(() =>
      parseWorkflow('{"id":"x","steps":[{"type":"log","input":{}}]}', "json")
    ).toThrow(CompilationError)
  })

  it("rejects step without type", () => {
    expect(() =>
      parseWorkflow('{"id":"x","steps":[{"id":"s1","input":{}}]}', "json")
    ).toThrow(CompilationError)
  })

  it("rejects invalid trigger type", () => {
    expect(() =>
      parseWorkflow(
        JSON.stringify({
          id: "x",
          steps: [{ id: "s1", type: "log", input: {} }],
          trigger: { type: "invalid" },
        }),
        "json"
      )
    ).toThrow(CompilationError)
  })

  it("parses trigger with config", () => {
    const wf = parseWorkflow(validJSON, "json")
    expect(wf.trigger).toBeDefined()
    expect(wf.trigger!.type).toBe("webhook")
    expect(wf.trigger!.config).toEqual({ method: "POST" })
  })

  it("allows workflow without trigger", () => {
    const input = JSON.stringify({
      id: "x",
      steps: [{ id: "s1", type: "log", input: {} }],
    })
    const wf = parseWorkflow(input, "json")
    expect(wf.trigger).toBeUndefined()
  })

  it("parses next as string", () => {
    const wf = parseWorkflow(validJSON, "json")
    expect(wf.steps[1].next).toBe("save")
  })

  it("parses next as array", () => {
    const input = JSON.stringify({
      id: "x",
      steps: [
        { id: "a", type: "http.request", input: {}, next: ["b", "c"] },
        { id: "b", type: "log", input: {} },
        { id: "c", type: "log", input: {} },
      ],
    })
    const wf = parseWorkflow(input, "json")
    expect(wf.steps[0].next).toEqual(["b", "c"])
  })

  it("parses onFailure.retry config", () => {
    const input = JSON.stringify({
      id: "x",
      steps: [
        {
          id: "s1",
          type: "http.request",
          input: {},
          onFailure: { retry: { maxAttempts: 3, delayMs: 1000 } },
        },
      ],
    })
    const wf = parseWorkflow(input, "json")
    expect(wf.steps[0].onFailure?.retry).toEqual({ maxAttempts: 3, delayMs: 1000 })
  })

  it("parses onFailure.fallback", () => {
    const input = JSON.stringify({
      id: "x",
      steps: [
        { id: "s1", type: "http.request", input: {}, onFailure: { fallback: "s2" } },
        { id: "s2", type: "log", input: {} },
      ],
    })
    const wf = parseWorkflow(input, "json")
    expect(wf.steps[0].onFailure?.fallback).toBe("s2")
  })
})

describe("parseWorkflow — YAML", () => {
  it("parses valid YAML workflow", () => {
    const wf = parseWorkflow(validYAML, "yaml")
    expect(wf.id).toBe("wf-2")
    expect(wf.version).toBe("1.0.0")
    expect(wf.steps).toHaveLength(3)
    expect(wf.steps[0].type).toBe("http.request")
  })

  it("rejects invalid YAML", () => {
    expect(() => parseWorkflow("{{invalid", "yaml")).toThrow(CompilationError)
  })

  it("produces same AST as equivalent JSON", () => {
    const jsonWf = parseWorkflow(validJSON, "json")
    const yamlWf = parseWorkflow(validYAML, "yaml")
    expect(jsonWf.steps).toHaveLength(yamlWf.steps.length)
    expect(jsonWf.steps[0].type).toBe(yamlWf.steps[0].type)
    expect(jsonWf.steps[1].next).toBe(yamlWf.steps[1].next)
    expect(jsonWf.trigger?.type).toBe(yamlWf.trigger?.type)
  })
})
