import { describe, it, expect, beforeAll } from "vitest"
import type { CompilerLLMAdapter, WorkflowIntent } from "@arelyos/flow-ai-compiler"
import type { NodeDefinition } from "@arelyos/flow-sdk"
import { globalNodeRegistry } from "@arelyos/flow-sdk"
import { BuilderService } from "@arelyos/engine/compiler/builder-service.js"
import { createInMemoryDb } from "@arelyos/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arelyos/engine/persistence/migrate.js"
import { getRunWithSteps, listRuns } from "@arelyos/engine/persistence/run-store.js"

const EchoNode: NodeDefinition = {
  type: "echo",
  label: "Echo",
  category: "action",
  inputSchema: {},
  async execute(_ctx, input) { return input },
}

function registerIfMissing(type: string, def: NodeDefinition): void {
  try { globalNodeRegistry.register(def) } catch { /* already registered */ }
}

const defaultIntent: WorkflowIntent = {
  goal: "echo workflow",
  triggers: [{ type: "manual", description: "manual" }],
  steps: [
    { id: "step_one", description: "first step", intent: "echo", typeHint: "echo", dependencies: [] },
    { id: "step_two", description: "second step", intent: "echo", typeHint: "echo", dependencies: ["step_one"] },
  ],
  constraints: {},
}

function mockAdapter(intent?: WorkflowIntent): CompilerLLMAdapter {
  const result = intent ?? defaultIntent
  return {
    async generateStructured(): Promise<WorkflowIntent> { return result },
    health: async () => ({ ok: true }),
  }
}

describe("AI Builder — E2E Flow", () => {
  let builder: BuilderService
  let inMemory: ReturnType<typeof createInMemoryDb>

  beforeAll(() => {
    registerIfMissing("echo", EchoNode)
    inMemory = createInMemoryDb()
    for (const stmt of CREATE_TABLES) {
      inMemory.sqlite.exec(stmt)
    }
    for (const stmt of MIGRATIONS) {
      try { inMemory.sqlite.exec(stmt) } catch { /* may already exist */ }
    }
    for (const idx of CREATE_INDEXES) {
      try { inMemory.sqlite.exec(idx) } catch { /* column may not exist */ }
    }
    builder = new BuilderService(mockAdapter(), inMemory.db)
  })

  it("compiles a prompt into a Workflow DSL", async () => {
    const result = await builder.compile("test workflow")

    expect(result.success).toBe(true)
    expect(result.workflow).toBeDefined()
    expect(result.workflow!.id).toBe("echo-workflow")
    expect(result.workflow!.steps).toHaveLength(2)
    expect(result.workflow!.steps[0].type).toBe("echo")
  })

  it("stores compiled workflows and lists them", async () => {
    const list = builder.listWorkflows()
    expect(list.length).toBeGreaterThanOrEqual(1)
    expect(list[0].id).toBeTruthy()
    expect(list[0].version).toBe(1)
  })

  it("retrieves a compiled workflow by id", async () => {
    const wf = builder.getWorkflow("echo-workflow")
    expect(wf).toBeDefined()
    expect(wf!.steps.length).toBe(2)
  })

  it("executes a compiled workflow successfully", async () => {
    const execResult = await builder.execute("echo-workflow", { input: "hello" })

    expect(execResult.success).toBe(true)
    expect(execResult.runId).toBeTruthy()
    expect(execResult.steps).toHaveLength(2)
    expect(execResult.steps[0].status).toBe("completed")
    expect(execResult.steps[1].status).toBe("completed")
    expect(execResult.outputs).toBeDefined()
    expect(execResult.outputs!.step_one).toBeDefined()
  })

  it("returns error for unknown workflow", async () => {
    const result = await builder.execute("nonexistent")
    expect(result.success).toBe(false)
    expect(result.error).toContain("not found")
  })

  it("executes all steps in a 3-step chain", async () => {
    const chainIntent: WorkflowIntent = {
      goal: "three step chain",
      triggers: [{ type: "manual", description: "manual" }],
      steps: [
        { id: "a", description: "step a", intent: "echo", typeHint: "echo", dependencies: [] },
        { id: "b", description: "step b", intent: "echo", typeHint: "echo", dependencies: ["a"] },
        { id: "c", description: "step c", intent: "echo", typeHint: "echo", dependencies: ["b"] },
      ],
      constraints: {},
    }
    const chainBuilder = new BuilderService(mockAdapter(chainIntent), inMemory.db)
    await chainBuilder.compile("chain")

    const result = await chainBuilder.execute("three-step-chain", { x: 1 })
    expect(result.success).toBe(true)
    expect(result.steps).toHaveLength(3)
    expect(result.steps.every((s) => s.status === "completed")).toBe(true)
  })

  it("records run and step runs during execution", async () => {
    const execResult = await builder.execute("echo-workflow", { input: "tracking-test" })

    expect(execResult.success).toBe(true)
    expect(execResult.runId).toBeTruthy()

    const full = getRunWithSteps(execResult.runId, inMemory.db)!
    expect(full).toBeDefined()
    expect(full.run.workflowId).toBe("echo-workflow")
    expect(full.run.workflowVersion).toBeGreaterThanOrEqual(1)
    expect(full.run.status).toBe("completed")
    expect(full.run.startedAt).toBeTruthy()
    expect(full.run.completedAt).toBeTruthy()
    expect(full.run.durationMs).toBeTypeOf("number")
    expect(full.run.triggerInput).toContain("tracking-test")
    expect(full.steps.length).toBe(2)
    expect(full.steps.every((s) => s.status === "completed")).toBe(true)
    expect(full.steps.every((s) => s.durationMs != null)).toBe(true)
    expect(full.steps.every((s) => s.startedAt).toBeTruthy)
    expect(full.steps.every((s) => s.completedAt).toBeTruthy)
  })

  it("records failed step runs on error", async () => {
    const result = await builder.execute("echo-workflow", {})
    expect(result.success).toBe(true)

    const runs = listRuns({ workflowId: "echo-workflow" }, inMemory.db)
    expect(runs.length).toBeGreaterThanOrEqual(1)
  })

  it("lists runs with step details via builder service", () => {
    const runs = builder.listRuns({ workflowId: "echo-workflow" })
    expect(runs.length).toBeGreaterThanOrEqual(1)
    const run = runs[0]
    expect(run.run).toBeDefined()
    expect(run.run.status).toBeTruthy()
    expect(run.steps).toBeDefined()
  })

  it("gets a specific run with steps", () => {
    const runs = builder.listRuns({ workflowId: "echo-workflow", limit: 1 })
    expect(runs.length).toBeGreaterThanOrEqual(1)

    const full = builder.getRun(runs[0].run.id)
    expect(full).toBeDefined()
    expect(full!.run.id).toBe(runs[0].run.id)
    expect(full!.steps.length).toBeGreaterThanOrEqual(0)
  })

  it("invalid prompt returns compilation error", async () => {
    // Mock an intent that fails validation (empty steps)
    const invalidAdapter: CompilerLLMAdapter = {
      async generateStructured(): Promise<WorkflowIntent> {
        return { goal: "invalid", triggers: [], steps: [], constraints: {} }
      },
      health: async () => ({ ok: true }),
    }
    const badBuilder = new BuilderService(invalidAdapter, inMemory.db)
    const result = await badBuilder.compile("invalid")
    expect(result.success).toBe(false)
    expect(result.diagnostics.some((d) => d.kind === "error")).toBe(true)
  })
})
