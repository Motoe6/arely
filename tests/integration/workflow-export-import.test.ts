import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { globalNodeRegistry, HttpNode, LLMNode } from "@opencode/flow-sdk"
import type { CompilerLLMAdapter, WorkflowIntent } from "@opencode/flow-ai-compiler"
import type { NodeDefinition } from "@opencode/flow-sdk"
import { BuilderService } from "@opencode/engine/compiler/builder-service.js"
import { createHttpServer } from "@opencode/engine/transport/http-server.js"
import { registerBuilderRoutes } from "@opencode/engine/compiler/builder-routes.js"
import { SSEBus } from "@opencode/engine/server/sse.js"
import { loadConfig } from "@opencode/engine/config/index.js"
import { connect, close } from "@opencode/engine/persistence/database.js"
import { pushSchema } from "@opencode/engine/persistence/migrate.js"
import { bodyParser } from "@opencode/engine/transport/middleware.js"
import { getWorkflowWithCurrentVersion } from "@opencode/engine/persistence/workflow-store.js"
import http from "node:http"

const EchoNode: NodeDefinition = {
  type: "echo",
  label: "Echo",
  category: "action",
  inputSchema: {},
  async execute(_ctx, input) { return input },
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

function listenOnRandomPort(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address()
      resolve(typeof addr === "object" ? addr!.port : 0)
    })
  })
}

function fetchJson(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ""
      res.on("data", (chunk: string) => { body += chunk })
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }))
    }).on("error", (err: Error) => reject(err))
  })
}

function postJson(url: string, data: unknown): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data)
    const req = http.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload).toString(),
      },
    }, (res) => {
      let body = ""
      res.on("data", (chunk: string) => { body += chunk })
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }))
    })
    req.on("error", (err: Error) => reject(err))
    req.write(payload)
    req.end()
  })
}

import { createWorkflow as cwf, createWorkflowVersion as cwfv } from "@opencode/engine/persistence/workflow-store.js"
import { createSession } from "@opencode/engine/persistence/session-store.js"
import { normalizeWorkflow } from "@opencode/flow-runtime"
import { ulid } from "ulid"

describe("Workflow Export / Import", () => {
  it("DEBUG: direct DB export/import roundtrip", () => {
    const exported = builder.getWorkflow(workflowId)!
    expect(exported).toBeDefined()
    const raw = JSON.stringify(exported)
    const parsed = JSON.parse(raw)
    const norm = normalizeWorkflow(parsed)
    const newId = ulid()
    const imported = { ...norm, id: newId }
    const rec = cwf({ id: newId, name: imported.name, description: imported.description })
    const ver = cwfv(rec.id, JSON.stringify(imported), "active")
    expect(ver).toBeDefined()
    expect(ver.workflowId).toBe(newId)
    console.error("DEBUG roundtrip OK:", newId, ver.id)
  })
  let sse: SSEBus
  let server: http.Server
  let port: number
  let builder: BuilderService
  let workflowId: string

  beforeAll(async () => {
    process.env.OPENCODE_API_KEY = "test-key"
    loadConfig()
    connect(":memory:")
    pushSchema()
    try { globalNodeRegistry.register(HttpNode) } catch { /* ok */ }
    try { globalNodeRegistry.register(LLMNode) } catch { /* ok */ }
    try { globalNodeRegistry.register(EchoNode) } catch { /* ok */ }

    createSession({ id: "default", query: "import-test", model: "test-model" })

    builder = new BuilderService(mockAdapter())

    const result = await builder.compile("test workflow")
    workflowId = result.workflow!.id

    sse = new SSEBus()
    server = createHttpServer({
      sse,
      port: 0,
      middleware: [bodyParser("1mb", [])],
      setupRoutes: (router) => {
        registerBuilderRoutes(router, builder, sse)
      },
    })
    port = await listenOnRandomPort(server)
  })

  afterAll(() => {
    server?.close()
    globalNodeRegistry.unregister("echo")
    globalNodeRegistry.unregister("http")
    globalNodeRegistry.unregister("llm")
    close()
  })

  describe("GET /api/flow/workflows/:id/export", () => {
    it("returns 404 for nonexistent workflow", async () => {
      const { statusCode, body } = await fetchJson(
        `http://localhost:${port}/api/flow/workflows/nonexistent/export`,
      )
      expect(statusCode).toBe(404)
      const data = JSON.parse(body)
      expect(data.error).toBe("Workflow not found")
    })

    it("returns wrapped payload for existing workflow", async () => {
      const { statusCode, body } = await fetchJson(
        `http://localhost:${port}/api/flow/workflows/${workflowId}/export`,
      )
      expect(statusCode).toBe(200)
      const data = JSON.parse(body)

      expect(data.formatVersion).toBe("1.0")
      expect(data.exportedAt).toBeDefined()
      expect(data.engineVersion).toBe("0.1.0")
      expect(data.source).toBeDefined()
      expect(data.source.workflowId).toBe(workflowId)
      expect(data.source.versionId).toBeDefined()
      expect(data.workflow).toBeDefined()
      expect(data.workflow.id).toBe(workflowId)
      expect(Array.isArray(data.workflow.steps)).toBe(true)
      expect(data.workflow.steps.length).toBeGreaterThan(0)
    })
  })

  describe("POST /api/flow/workflows/import", () => {
    it("returns 400 for missing body", async () => {
      const { statusCode, body } = await postJson(
        `http://localhost:${port}/api/flow/workflows/import`,
        null,
      )
      expect(statusCode).toBe(400)
      const data = JSON.parse(body)
      expect(data.error).toBe("Invalid JSON body")
    })

    it("returns 400 for unsupported formatVersion", async () => {
      const { statusCode, body } = await postJson(
        `http://localhost:${port}/api/flow/workflows/import`,
        { formatVersion: "2.0", workflow: { steps: [] } },
      )
      expect(statusCode).toBe(400)
      const data = JSON.parse(body)
      expect(data.error).toContain("Unsupported formatVersion")
    })

    it("returns 422 for invalid workflow", async () => {
      const { statusCode, body } = await postJson(
        `http://localhost:${port}/api/flow/workflows/import`,
        { formatVersion: "1.0", workflow: { id: "bad", steps: "not-an-array" } },
      )
      expect(statusCode).toBe(422)
      const data = JSON.parse(body)
      expect(data.error).toContain("Invalid workflow")
    })

    it("creates workflow with new ID preserving content", async () => {
      // Export first
      const exported = await fetchJson(
        `http://localhost:${port}/api/flow/workflows/${workflowId}/export`,
      )
      const exportData = JSON.parse(exported.body)
      const originalId = exportData.workflow.id

      // Modify name to verify roundtrip
      exportData.workflow.name = "imported-via-test"

      const { statusCode, body } = await postJson(
        `http://localhost:${port}/api/flow/workflows/import`,
        exportData,
      )
      if (statusCode !== 201) console.error("IMPORT ERROR BODY:", body)
      expect(statusCode).toBe(201)
      const data = JSON.parse(body)
      expect(data.workflowId).toBeDefined()
      expect(data.versionId).toBeDefined()
      expect(data.workflowId).not.toBe(originalId)

      // Verify persisted workflow has new ID and preserved content
      const entry = getWorkflowWithCurrentVersion(data.workflowId)
      expect(entry).toBeDefined()
      expect(entry!.workflow.name).toBe("imported-via-test")
      expect(entry!.version).toBeDefined()

      const stored = JSON.parse(entry!.version.workflowDsl)
      expect(stored.id).toBe(data.workflowId)
      expect(Array.isArray(stored.steps)).toBe(true)
      expect(stored.steps.length).toBe(exportData.workflow.steps.length)
    })

    it("can import same payload twice (different IDs)", async () => {
      const exported = await fetchJson(
        `http://localhost:${port}/api/flow/workflows/${workflowId}/export`,
      )
      const exportData = JSON.parse(exported.body)

      const r1 = await postJson(
        `http://localhost:${port}/api/flow/workflows/import`,
        exportData,
      )
      const r2 = await postJson(
        `http://localhost:${port}/api/flow/workflows/import`,
        exportData,
      )

      const d1 = JSON.parse(r1.body)
      const d2 = JSON.parse(r2.body)
      expect(d1.workflowId).not.toBe(d2.workflowId)
    })

    it("roundtrip: export → import preserves steps and execution", async () => {
      const exported = await fetchJson(
        `http://localhost:${port}/api/flow/workflows/${workflowId}/export`,
      )
      const exportData = JSON.parse(exported.body)

      const { statusCode, body } = await postJson(
        `http://localhost:${port}/api/flow/workflows/import`,
        exportData,
      )
      expect(statusCode).toBe(201)
      const { workflowId: newId } = JSON.parse(body)

      // Execute the imported workflow
      const execResult = await builder.execute(newId, { input: "roundtrip" })
      expect(execResult.success).toBe(true)
      expect(execResult.runId).toBeTruthy()
      expect(execResult.steps.every((s) => s.status === "completed")).toBe(true)
    })
  })
})
