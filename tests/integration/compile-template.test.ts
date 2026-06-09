import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { TemplateRegistry } from "@opencode/engine/templates/template-registry.js"
import { registerTemplateRoutes } from "@opencode/engine/templates/template-routes.js"
import { registerBuilderRoutes } from "@opencode/engine/compiler/builder-routes.js"
import { BuilderService } from "@opencode/engine/compiler/builder-service.js"
import { createHttpServer } from "@opencode/engine/transport/http-server.js"
import { SSEBus } from "@opencode/engine/server/sse.js"
import { globalNodeRegistry, HttpNode, LLMNode } from "@opencode/flow-sdk"
import { loadConfig } from "@opencode/engine/config/index.js"
import { connect, close } from "@opencode/engine/persistence/database.js"
import { bodyParser } from "@opencode/engine/transport/middleware.js"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import http from "node:http"
import type { CompilerLLMAdapter, WorkflowIntent } from "@opencode/flow-ai-compiler"
import type { Template } from "@opencode/engine/templates/template-types.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const BUILTIN_DIR = join(__dirname, "..", "..", "packages", "engine", "templates")

function makeIntent(goal: string, typeHint = "http"): WorkflowIntent {
  return {
    goal,
    triggers: [{ type: "manual", description: "manual" }],
    steps: [
      { id: "step_one", description: "first step", intent: goal, typeHint, dependencies: [] },
    ],
    constraints: {},
  }
}

function mockAdapter(intent: WorkflowIntent, track?: { called: boolean }): CompilerLLMAdapter {
  return {
    async generateStructured(): Promise<WorkflowIntent> {
      if (track) track.called = true
      return intent
    },
    health: async () => ({ ok: true }),
  }
}

function makeTemplate(overrides: Partial<Template["metadata"]> & { id: string }): Template {
  return {
    metadata: {
      name: overrides.id,
      description: "",
      category: "uncategorized",
      tags: [],
      templateVersion: "1.0.0",
      author: "Test",
      parameters: [],
      requires: [],
      source: "builtin",
      ...overrides,
    },
    workflowDsl: "name: test\ndescription: test\nsteps:\n  - id: step1\n    type: http\n    input:\n      url: https://example.com",
    workflowObj: {
      name: "test",
      description: "test",
      steps: [{ id: "step1", type: "http", input: { url: "https://example.com" } }],
    },
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

describe("Compile with Template Recommendation (T6.2)", () => {
  let registry: TemplateRegistry
  let userDir: string

  beforeAll(() => {
    process.env.OPENCODE_API_KEY = "test-key"
    loadConfig()
    connect(":memory:")

    try { globalNodeRegistry.register(HttpNode) } catch { /* ok */ }
    try { globalNodeRegistry.register(LLMNode) } catch { /* ok */ }

    registry = new TemplateRegistry()
    registry.reloadBuiltins(BUILTIN_DIR)
    userDir = mkdtempSync(join(tmpdir(), "compile-template-test-"))
  })

  afterAll(() => {
    try { globalNodeRegistry.unregister("http") } catch { /* ok */ }
    try { globalNodeRegistry.unregister("llm") } catch { /* ok */ }
    rmSync(userDir, { recursive: true, force: true })
    close()
  })

  async function withServer<T>(
    fn: (port: number) => Promise<T>,
    templateRegistry?: TemplateRegistry,
    builder?: BuilderService,
  ): Promise<T> {
    const sse = new SSEBus()
    const reg = templateRegistry ?? registry
    const bld = builder ?? new BuilderService(mockAdapter(makeIntent("default workflow")))
    const server = createHttpServer({
      sse,
      port: 0,
      middleware: [bodyParser("1mb", [])],
      setupRoutes: (router) => {
        registerBuilderRoutes(router, bld, sse, undefined, reg)
        registerTemplateRoutes(router, reg, BUILTIN_DIR, userDir)
      },
    })
    try {
      const port = await listenOnRandomPort(server)
      return await fn(port)
    } finally {
      server.close()
    }
  }

  it("returns template workflow when high-confidence match with no required params", async () => {
    const localReg = new TemplateRegistry()
    localReg.registerInline(makeTemplate({
      id: "my-custom-webhook",
      name: "Webhook Relay Custom",
      description: "A webhook relay for forwarding events",
      tags: ["webhook", "relay", "http"],
      parameters: [],
    }))
    const aiCalled = { called: false }
    const builder = new BuilderService(mockAdapter(makeIntent("template test"), aiCalled))

    await withServer(async (port) => {
      const { statusCode, body } = await postJson(
        `http://localhost:${port}/api/flow/compile`,
        { prompt: "webhook relay" },
      )
      expect(statusCode).toBe(200)
      const data = JSON.parse(body)
      expect(data.success).toBe(true)
      expect(data.workflow).toBeDefined()
      expect(data.workflow.steps).toBeDefined()
      expect(data.workflow.id).toBeTruthy()
      expect(data.diagnostics).toBeDefined()
      expect(data.diagnostics.some((d: { kind: string }) => d.kind === "warning")).toBe(true)
      expect(data.diagnostics.some((d: { message: string }) => d.message.includes("my-custom-webhook"))).toBe(true)
    }, localReg, builder)

    expect(aiCalled.called).toBe(false)
  })

  it("falls through to AI when template has required params and none provided", async () => {
    const aiCalled = { called: false }
    const builder = new BuilderService(mockAdapter(makeIntent("health check compile"), aiCalled))

    await withServer(async (port) => {
      const { statusCode, body } = await postJson(
        `http://localhost:${port}/api/flow/compile`,
        { prompt: "scheduled health check" },
      )
      expect(statusCode).toBe(200)
      const data = JSON.parse(body)
      expect(data.success).toBe(true)
      expect(data.workflow).toBeDefined()
    }, registry, builder)

    expect(aiCalled.called).toBe(true)
  })

  it("falls through to AI when no template matches", { timeout: 15000 }, async () => {
    const aiCalled = { called: false }
    const builder = new BuilderService(mockAdapter(makeIntent("weather notification flow"), aiCalled))

    await withServer(async (port) => {
      const { statusCode, body } = await postJson(
        `http://localhost:${port}/api/flow/compile`,
        { prompt: "create a workflow that fetches weather data and sends a notification" },
      )
      expect(statusCode).toBe(200)
      const data = JSON.parse(body)
      expect(data.success).toBe(true)
      expect(data.workflow).toBeDefined()
    }, registry, builder)

    expect(aiCalled.called).toBe(true)
  })

  it("returns 400 for empty prompt", async () => {
    await withServer(async (port) => {
      const { statusCode, body } = await postJson(
        `http://localhost:${port}/api/flow/compile`,
        { prompt: "" },
      )
      expect(statusCode).toBe(400)
      const data = JSON.parse(body)
      expect(data.error).toBeDefined()
    })
  })
})
