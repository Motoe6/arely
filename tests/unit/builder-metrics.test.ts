import { describe, it, expect, beforeAll } from "vitest"
import { createInMemoryDb } from "@opencode/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@opencode/engine/persistence/migrate.js"
import { BuilderService } from "@opencode/engine/compiler/builder-service.js"
import type { CompilerLLMAdapter, WorkflowIntent } from "@opencode/flow-ai-compiler"
import { globalNodeRegistry } from "@opencode/flow-sdk"
import type { NodeDefinition } from "@opencode/flow-sdk"

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

describe("Builder Metrics", () => {
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

  it("metrics summary returns zeros with no data", () => {
    const m = builder.getMetricsSummary()
    expect(m.totalRuns).toBe(0)
    expect(m.completedRuns).toBe(0)
    expect(m.failedRuns).toBe(0)
    expect(m.successRate).toBe(0)
    expect(m.failureRate).toBe(0)
    expect(m.avgDurationMs).toBe(0)
    expect(m.totalWorkflows).toBe(0)
    expect(m.runsPerDay).toBe(0)
    expect(m.topNodes).toEqual([])
    expect(m.slowestNodes).toEqual([])
  })

  it("metrics summary reflects runs after compile + execute", async () => {
    await builder.compile("metrics test")
    const exec1 = await builder.execute("echo-workflow", { x: 1 })
    const exec2 = await builder.execute("echo-workflow", { x: 2 })

    const m = builder.getMetricsSummary()
    expect(m.totalRuns).toBeGreaterThanOrEqual(2)
    expect(m.completedRuns).toBeGreaterThanOrEqual(2)
    expect(m.successRate).toBe(100)
    expect(m.totalWorkflows).toBeGreaterThanOrEqual(1)
    expect(m.totalDurationMs).toBeGreaterThan(0)
    expect(m.runsPerDay).toBeGreaterThan(0)
    expect(m.topNodes.length).toBeGreaterThan(0)
    expect(m.topNodes[0].stepType).toBe("echo")
    expect(m.slowestNodes.length).toBeGreaterThan(0)
  })

  it("workflow metrics returns null for unknown workflow", () => {
    const m = builder.getWorkflowMetrics("nonexistent")
    expect(m).toBeNull()
  })

  it("workflow metrics returns data for known workflow", () => {
    const m = builder.getWorkflowMetrics("echo-workflow")
    expect(m).not.toBeNull()
    expect(m!.workflowId).toBe("echo-workflow")
    expect(m!.totalRuns).toBeGreaterThanOrEqual(2)
    expect(m!.completedRuns).toBeGreaterThanOrEqual(2)
    expect(m!.successRate).toBe(100)
    expect(m!.avgDurationMs).toBeGreaterThan(0)
    expect(m!.totalVersions).toBeGreaterThanOrEqual(1)
    expect(m!.slowestSteps.length).toBeGreaterThan(0)
    expect(m!.mostFailedSteps.length).toBeGreaterThan(0)
  })

  it("updateWorkflow changes name and description", () => {
    builder.updateWorkflow("echo-workflow", { name: "Renamed", description: "Updated desc" })

    const list = builder.listWorkflows()
    const wf = list.find((w) => w.id === "echo-workflow")
    expect(wf).toBeDefined()
    expect(wf!.description).toBe("Updated desc")
  })

  it("listWorkflowVersions returns all versions", () => {
    const versions = builder.listWorkflowVersions("echo-workflow")
    expect(versions.length).toBeGreaterThanOrEqual(1)
    expect(versions[0].workflowId).toBe("echo-workflow")
    expect(versions[0].version).toBeGreaterThanOrEqual(1)
    expect(versions[0].workflowDsl).toBeTruthy()
  })
})

describe("Builder Workflow CRUD", () => {
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

  it("deleteWorkflow removes workflow and cascade deletes versions and runs", async () => {
    const deleteIntent: WorkflowIntent = {
      goal: "delete me",
      triggers: [{ type: "manual", description: "manual" }],
      steps: [{ id: "only_step", description: "only", intent: "echo", typeHint: "echo", dependencies: [] }],
      constraints: {},
    }
    const deleteBuilder = new BuilderService(mockAdapter(deleteIntent), inMemory.db)
    await deleteBuilder.compile("delete me")

    const wfId = "delete-me"
    expect(deleteBuilder.getWorkflow(wfId)).toBeDefined()

    deleteBuilder.deleteWorkflow(wfId)
    expect(deleteBuilder.getWorkflow(wfId)).toBeUndefined()
  })
})
