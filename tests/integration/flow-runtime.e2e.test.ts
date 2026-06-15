import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { initTestDb, cleanupTestDb } from "../setup.js"
import { parseWorkflow, compileWorkflow } from "@arely/flow-runtime"
import { createPipeline, createPipelineStep, getPipelineRun, getPipelineSteps, getPipelineStepRuns } from "@arely/engine/agents/pipeline-store.js"
import { executePipeline } from "@arely/engine/agents/pipeline.js"
import { createExecutionTracer } from "@arely/engine/agents/execution-tracer.js"
import { getDb } from "@arely/engine/persistence/database.js"
import { pipelineStepRuns, pipelineSteps, pipelineRuns, agentPipelines } from "@arely/engine/persistence/schema.js"

describe("Flow Runtime E2E — YAML → Compiler → F30 → Audit", () => {
  beforeAll(() => {
    initTestDb()
  })

  afterAll(() => {
    cleanupTestDb()
  })

  afterEach(() => {
    const db = getDb()
    db.delete(pipelineStepRuns).run()
    db.delete(pipelineRuns).run()
    db.delete(pipelineSteps).run()
    db.delete(agentPipelines).run()
  })

  it("compiles YAML, executes via F30, verifies audit trail", async () => {
    const yaml = `
id: e2e-workflow
version: "1.0.0"
trigger:
  type: manual
steps:
  - id: greet
    type: echo
    input:
      message: "Hello {{ trigger.user }}"
      api_key: "{{ secrets.api_key }}"
  - id: process
    type: echo
    input:
      previous: "{{steps.greet.output}}"
      raw: true
`

    const workflow = parseWorkflow(yaml, "yaml")
    const ctx = {
      trigger: { user: "Alice" },
      steps: new Map(),
      secrets: new Map([["api_key", "sk-secret"]]),
    }

    const compiled = compileWorkflow(workflow, ctx)

    // Assert 1 — compiler correctness
    expect(compiled.errors).toHaveLength(0)
    expect(compiled.pipeline.steps).toHaveLength(2)

    // Assert 2 — template resolution at compile time
    const greetInput = JSON.parse(compiled.pipeline.steps.find((s) => s.id === "greet")!.inputMapping)
    expect(greetInput.message).toBe("Hello Alice")
    expect(greetInput.api_key).toBe("sk-secret")

    // Assert 3 — step references converted to F30 runtime format
    const processInput = JSON.parse(compiled.pipeline.steps.find((s) => s.id === "process")!.inputMapping)
    expect(processInput.previous).toBe("{{greet}}")

    // Assert 4 — DAG construction (sequential: process depends on greet)
    const greetStep = compiled.pipeline.steps.find((s) => s.id === "greet")!
    const processStep = compiled.pipeline.steps.find((s) => s.id === "process")!
    expect(greetStep.dependsOn).toEqual([])
    expect(processStep.dependsOn).toEqual(["greet"])

    // Bridge to F30: use compiler step IDs (DSL IDs) directly in dependsOn
    // and set outputKey = DSL ID for runtime {{stepId}} resolution.
    const pipeline = createPipeline({ name: "E2E Flow Test" })
    for (const step of compiled.pipeline.steps) {
      createPipelineStep({
        pipelineId: pipeline.id,
        type: "tool",
        toolName: step.toolName,
        stepOrder: step.stepOrder,
        dependsOn: JSON.stringify(step.dependsOn),
        inputMapping: step.inputMapping,
        outputKey: step.id,
        retries: step.retries ?? undefined,
        retryDelayMs: step.retryDelayMs ?? undefined,
      })
    }

    const tracer = createExecutionTracer()
    const mockExecuteTool = async (toolName: string, args: Record<string, unknown>) => {
      return { content: JSON.stringify(args) }
    }

    const result = await executePipeline(pipeline.id, {
      sessionManager: {} as any,
      llm: {} as any,
      executeTool: mockExecuteTool,
    }, tracer)

    // Assert 5 — pipeline execution
    expect(result.ok).toBe(true)
    expect(result.stepResults).toHaveLength(2)
    expect(result.stepResults.every((s) => s.status === "completed")).toBe(true)

    // Assert 6 — pipeline final state
    const runRecord = getPipelineRun(result.runId)
    expect(runRecord).toBeDefined()
    expect(runRecord!.status).toBe("completed")
    expect(runRecord!.stepsTotal).toBe(2)
    expect(runRecord!.stepsCompleted).toBe(2)

    // Assert 7 — F31 audit trail (step runs persisted by tracer)
    const stepRuns = getPipelineStepRuns(result.runId)
    expect(stepRuns).toHaveLength(2)
    expect(stepRuns.every((r) => r.status === "completed")).toBe(true)

    // Assert 8 — runtime template resolution (F30 resolved {{greet}})
    const processRun = stepRuns.find((r) => r.toolName === "echo" && r.input?.includes("{{greet}}"))
    expect(processRun).toBeDefined()
    expect(processRun!.input).toBeTruthy()
    const parsedProcessInput = JSON.parse(processRun!.input ?? "{}")
    const inputMapping = JSON.parse(parsedProcessInput.inputMapping)
    expect(inputMapping.previous).toBe("{{greet}}")
  })

  it("reports compilation errors gracefully without crash", async () => {
    const badYAML = `
id: bad-flow
version: "1.0.0"
steps:
  - id: a
    type: echo
    input: {}
    next: nonexistent
`

    const workflow = parseWorkflow(badYAML, "yaml")
    const compiled = compileWorkflow(workflow, {
      trigger: {},
      steps: new Map(),
      secrets: new Map(),
    })

    expect(compiled.errors.length).toBeGreaterThan(0)
    expect(compiled.errors.some((e) => e.message.includes("nonexistent"))).toBe(true)
  })

  it("preserves execution order with explicit next", async () => {
    const yaml = `
id: explicit-order
version: "1.0.0"
steps:
  - id: step_c
    type: echo
    input: { order: 3 }
    next: step_a
  - id: step_a
    type: echo
    input: { order: 1 }
    next: step_b
  - id: step_b
    type: echo
    input: { order: 2 }
`

    const workflow = parseWorkflow(yaml, "yaml")
    const compiled = compileWorkflow(workflow, {
      trigger: {},
      steps: new Map(),
      secrets: new Map(),
    })

    expect(compiled.errors).toHaveLength(0)
    expect(compiled.pipeline.steps).toHaveLength(3)

    const pipeline = createPipeline({ name: "Explicit Order" })
    for (const step of compiled.pipeline.steps) {
      createPipelineStep({
        pipelineId: pipeline.id,
        type: "tool",
        toolName: step.toolName,
        stepOrder: step.stepOrder,
        dependsOn: JSON.stringify(step.dependsOn),
        inputMapping: step.inputMapping,
        outputKey: step.id,
        retries: step.retries ?? undefined,
        retryDelayMs: step.retryDelayMs ?? undefined,
      })
    }

    const executed: number[] = []
    const tracer = createExecutionTracer()
    const result = await executePipeline(pipeline.id, {
      sessionManager: {} as any,
      llm: {} as any,
      executeTool: async (toolName, args) => {
        executed.push(args.order as number)
        return { content: `executed ${args.order}` }
      },
    }, tracer)

    expect(result.ok).toBe(true)
    expect(executed).toEqual([3, 1, 2])
  })
})
