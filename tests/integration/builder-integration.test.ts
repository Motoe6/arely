import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { NodeDefinition } from "@arely/flow-sdk"
import { globalNodeRegistry } from "@arely/flow-sdk"
import { BuilderService } from "@arely/engine/compiler/builder-service.js"
import { createInMemoryDb } from "@arely/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arely/engine/persistence/migrate.js"
import { createWorkflow, createWorkflowVersion, getWorkflowWithCurrentVersion } from "@arely/engine/persistence/workflow-store.js"
import { createRun, createStepRun, completeStepRun, completeRun } from "@arely/engine/persistence/run-store.js"
import { resetKey } from "@arely/engine/compiler/secrets-crypto.js"
import type { CompilerLLMAdapter, WorkflowIntent } from "@arely/flow-ai-compiler"
import { createSchedule, listSchedules, getSchedule, deleteSchedule, getDueSchedules } from "@arely/engine/compiler/scheduler-store.js"
import { createSecret, getSecret, listSecrets, updateSecret, deleteSecret, loadSecretsMap } from "@arely/engine/compiler/secrets-store.js"
import { replayRun, replayFromStep } from "@arely/engine/compiler/replay-service.js"
import { NodePackageLoader } from "@arely/engine/compiler/node-package-loader.js"
import {
  listInstalledNodes,
  getInstalledNode,
  getInstalledNodeByType,
} from "@arely/engine/compiler/node-marketplace-store.js"

const EchoNode: NodeDefinition = {
  type: "echo",
  label: "Echo",
  category: "action",
  inputSchema: {},
  async execute(_ctx, input) { return input },
}

const echoIntent: WorkflowIntent = {
  goal: "echo workflow",
  triggers: [{ type: "manual", description: "manual" }],
  steps: [
    { id: "s1", description: "first", intent: "echo", typeHint: "echo", dependencies: [] },
    { id: "s2", description: "second", intent: "echo", typeHint: "echo", dependencies: ["s1"] },
    { id: "s3", description: "third", intent: "echo", typeHint: "echo", dependencies: ["s2"] },
  ],
  constraints: {},
}

function mockAdapter(): CompilerLLMAdapter {
  return {
    async generateStructured(): Promise<WorkflowIntent> { return echoIntent },
    health: async () => ({ ok: true }),
  }
}

describe("Builder Integration — Scheduler, Secrets, Replay", () => {
  let db: ReturnType<typeof createInMemoryDb>
  let builder: BuilderService
  let wfId: string

  beforeAll(() => {
    try { globalNodeRegistry.register(EchoNode) } catch { /* already registered */ }

    db = createInMemoryDb()
    db.sqlite.exec("PRAGMA foreign_keys = OFF")
    for (const stmt of CREATE_TABLES) { db.sqlite.exec(stmt) }
    for (const stmt of MIGRATIONS) { try { db.sqlite.exec(stmt) } catch {} }
    for (const idx of CREATE_INDEXES) { try { db.sqlite.exec(idx) } catch {} }

    resetKey()
    process.env.FLOW_SECRET_KEY = "integration-test-key"
    resetKey()

    builder = new BuilderService(mockAdapter(), db.db)

    const record = createWorkflow({ name: "integ-test-wf" }, db.db)
    wfId = record.id
    createWorkflowVersion(wfId, JSON.stringify({
      id: wfId, name: "integ-test-wf", version: "1.0.0",
      steps: [
        { id: "s1", type: "echo", input: { message: "a" }, next: "s2" },
        { id: "s2", type: "echo", input: { message: "b" }, next: "s3" },
        { id: "s3", type: "echo", input: { message: "c" } },
      ],
    }), "active", db.db)
  })

  // Scheduler
  it("creates and lists schedules", () => {
    createSchedule(wfId, "interval", null, 60000, db.db)
    createSchedule(wfId, "cron", "0 * * * *", null, db.db)
    const list = listSchedules(db.db)
    expect(list.length).toBeGreaterThanOrEqual(2)
  })

  it("gets and deletes a schedule", () => {
    const s = createSchedule(wfId, "interval", null, 30000, db.db)
    expect(getSchedule(s.id, db.db)).toBeDefined()
    deleteSchedule(s.id, db.db)
    expect(getSchedule(s.id, db.db)).toBeUndefined()
  })

  it("getDueSchedules returns array", () => {
    const due = getDueSchedules(db.db)
    expect(Array.isArray(due)).toBe(true)
  })

  // Secrets
  it("creates and retrieves secrets", () => {
    const secret = createSecret("integ_api_key", "sk-integ-test", db.db)
    const retrieved = getSecret(secret.id, db.db)
    expect(retrieved).toBeDefined()
    expect(retrieved!.value).toBe("sk-integ-test")
  })

  it("lists secrets without values", () => {
    const list = listSecrets(db.db)
    expect(list.length).toBeGreaterThanOrEqual(1)
    for (const s of list) {
      expect((s as Record<string, unknown>).value).toBeUndefined()
    }
  })

  it("updates and deletes secrets", () => {
    const secret = createSecret("integ_updatable", "old", db.db)
    updateSecret(secret.id, "new-value", db.db)
    expect(getSecret(secret.id, db.db)!.value).toBe("new-value")
    deleteSecret(secret.id, db.db)
    expect(getSecret(secret.id, db.db)).toBeUndefined()
  })

  // Replay
  it("replays a completed run", async () => {
    const entry = getWorkflowWithCurrentVersion(wfId, db.db)!
    const originalRun = createRun(wfId, entry.version.version, {}, db.db)
    for (const sid of ["s1", "s2", "s3"]) {
      const sr = createStepRun(originalRun.id, sid, "echo", {}, db.db)
      completeStepRun(sr.id, "completed", JSON.stringify({ echoed: sid }), undefined, db.db)
    }
    completeRun(originalRun.id, "completed", undefined, db.db)

    const result = await replayRun(originalRun.id, undefined, db.db)
    expect(result.success).toBe(true)
    expect(result.runId).not.toBe(originalRun.id)
    expect(result.steps).toHaveLength(3)
    expect(result.steps.every((s) => s.status === "completed")).toBe(true)
  })

  it("replayFromStep replays from a specific step", async () => {
    const entry = getWorkflowWithCurrentVersion(wfId, db.db)!
    const originalRun = createRun(wfId, entry.version.version, {}, db.db)
    for (const sid of ["s1", "s2", "s3"]) {
      const sr = createStepRun(originalRun.id, sid, "echo", {}, db.db)
      completeStepRun(sr.id, "completed", JSON.stringify({ echoed: sid }), undefined, db.db)
    }
    completeRun(originalRun.id, "completed", undefined, db.db)

    const result = await replayFromStep(originalRun.id, "s3", undefined, db.db)
    expect(result.success).toBe(true)
    expect(result.steps).toHaveLength(3)
  })

  it("secrets loaded into execute context", () => {
    const map = loadSecretsMap(db.db)
    expect(map.integ_api_key).toBe("sk-integ-test")
  })
})

describe("Builder Integration — Node Marketplace M1", () => {
  let db: ReturnType<typeof createInMemoryDb>
  let builder: BuilderService
  let loader: NodePackageLoader

  const tempDirs: string[] = []

  beforeAll(() => {
    db = createInMemoryDb()
    db.sqlite.exec("PRAGMA foreign_keys = OFF")
    for (const stmt of CREATE_TABLES) { db.sqlite.exec(stmt) }
    for (const stmt of MIGRATIONS) { try { db.sqlite.exec(stmt) } catch {} }
    for (const idx of CREATE_INDEXES) { try { db.sqlite.exec(idx) } catch {} }

    resetKey()
    process.env.FLOW_SECRET_KEY = "integration-test-key"
    resetKey()

    builder = new BuilderService(mockAdapter(), db.db)
    loader = new NodePackageLoader(db.db)
  })

  afterAll(() => {
    for (const node of globalNodeRegistry.list()) {
      if ((node.type as string).startsWith("smoke-") || (node.type as string).startsWith("market-")) {
        globalNodeRegistry.unregister(node.type)
      }
    }
    for (const dir of tempDirs) {
      try { rmSync(dir, { recursive: true, force: true }) } catch {}
    }
  })

  function createTempPackage(name: string, nodeType: string, version = "1.0.0", extra?: Partial<Record<string, unknown>>): string {
    const tmpDir = mkdtempSync(join(tmpdir(), `np-mkt-${name}-`))
    tempDirs.push(tmpDir)
    mkdirSync(join(tmpDir, "dist"), { recursive: true })
    const entryPath = join(tmpDir, "dist", "index.js")
    writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify({
      manifestVersion: 1,
      name,
      version,
      nodeType,
      category: "action",
      description: `Marketplace test: ${name}`,
      author: "Arely",
      entry: entryPath,
      ...extra,
    }))
    writeFileSync(entryPath, `
      export default {
        type: ${JSON.stringify(nodeType)},
        label: ${JSON.stringify(nodeType)},
        category: "action",
        inputSchema: {},
        execute: async (ctx, input) => ({ result: "ok", nodeType: ${JSON.stringify(nodeType)}, input })
      }
    `)
    return tmpDir
  }

  it("installs a valid package and registers the node", async () => {
    const tmpDir = createTempPackage("integ-pkg1", "market-node-1")
    const record = await loader.loadPackage(tmpDir)
    expect(record.name).toBe("integ-pkg1")
    expect(record.nodeType).toBe("market-node-1")
    expect(globalNodeRegistry.has("market-node-1")).toBe(true)
    const fromDb = getInstalledNodeByType("market-node-1", db.db)
    expect(fromDb).toBeDefined()
    expect(fromDb!.enabled).toBe(1)
  })

  it("lists installed nodes", async () => {
    const list = listInstalledNodes(false, db.db)
    const found = list.find((n) => n.name === "integ-pkg1")
    expect(found).toBeDefined()
    expect(found!.nodeType).toBe("market-node-1")
  })

  it("disables and re-enables a package", async () => {
    const tmpDir = createTempPackage("integ-toggle", "market-node-toggle")
    const record = await loader.loadPackage(tmpDir)
    expect(globalNodeRegistry.has("market-node-toggle")).toBe(true)

    loader.disable(record.id)
    expect(globalNodeRegistry.has("market-node-toggle")).toBe(false)
    const disabled = getInstalledNode(record.id, db.db)
    expect(disabled!.enabled).toBe(0)

    await loader.enable(record.id)
    expect(globalNodeRegistry.has("market-node-toggle")).toBe(true)
    const enabled = getInstalledNode(record.id, db.db)
    expect(enabled!.enabled).toBe(1)
  })

  it("removes a package", async () => {
    const tmpDir = createTempPackage("integ-remove", "market-node-remove")
    const record = await loader.loadPackage(tmpDir)
    expect(globalNodeRegistry.has("market-node-remove")).toBe(true)

    loader.remove(record.id)
    expect(globalNodeRegistry.has("market-node-remove")).toBe(false)
    expect(getInstalledNode(record.id, db.db)).toBeUndefined()
  })

  it("reloadEnabled loads persisted packages", async () => {
    const tmpDir = createTempPackage("integ-reload", "market-node-reload1")
    const record = await loader.loadPackage(tmpDir)
    globalNodeRegistry.unregister("market-node-reload1")
    expect(globalNodeRegistry.has("market-node-reload1")).toBe(false)

    await loader.reloadEnabled()
    expect(globalNodeRegistry.has("market-node-reload1")).toBe(true)
  })

  it("smoke test: install → execute workflow with installed node type", async () => {
    const tmpDir = createTempPackage("integ-smoke", "smoke-type")
    await loader.loadPackage(tmpDir)

    const wfRecord = createWorkflow({ name: "smoke-test-wf" }, db.db)
    createWorkflowVersion(wfRecord.id, JSON.stringify({
      id: wfRecord.id,
      name: "smoke-test-wf",
      steps: [
        { id: "s1", type: "smoke-type", input: { message: "hello-from-package" } },
      ],
    }), "active", db.db)

    const result = await builder.execute(wfRecord.id)
    expect(result.success).toBe(true)
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].status).toBe("completed")
  })
})
