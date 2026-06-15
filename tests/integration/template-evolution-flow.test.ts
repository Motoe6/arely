import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { TemplateRegistry } from "@arelyos/engine/templates/template-registry.js"
import { registerEvolutionRoutes } from "@arelyos/engine/compiler/evolution-routes.js"
import { createHttpServer } from "@arelyos/engine/transport/http-server.js"
import { SSEBus } from "@arelyos/engine/server/sse.js"
import { loadConfig } from "@arelyos/engine/config/index.js"
import { connect, close, createInMemoryDb } from "@arelyos/engine/persistence/database.js"
import { CREATE_TABLES, MIGRATIONS, CREATE_INDEXES } from "@arelyos/engine/persistence/migrate.js"
import { bodyParser } from "@arelyos/engine/transport/middleware.js"
import http from "node:http"

const MOCK_ADAPTER = {
  createSession: () => "mock-session-id",
  runSession: async () => ({ content: "mock", toolCalls: [] }),
} as never

function makeTemplate(registry: TemplateRegistry, id: string) {
  registry.registerInline({
    metadata: {
      id,
      name: "Integration Evolution Test",
      description: "Test template for evolution flow",
      category: "test",
      tags: [],
      templateVersion: "1.0.0",
      author: "Test",
      parameters: [
        { name: "interval", label: "Interval", type: "number", default: 60, required: false },
        { name: "timeout", label: "Timeout", type: "number", default: 1000, required: false },
        { name: "enabled", label: "Enabled", type: "boolean", default: false, required: false },
      ],
      requires: [],
      source: "builtin",
    },
    workflowDsl: "name: test\nsteps: []",
    workflowObj: { name: "test", steps: [] },
  })
}

function listenOnRandomPort(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address()
      resolve(typeof addr === "object" ? addr!.port : 0)
    })
  })
}

function postJson(url: string, data?: unknown): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : undefined
    const req = http.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload).toString() } : {}),
      },
    }, (res) => {
      let body = ""
      res.on("data", (chunk: string) => { body += chunk })
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }))
    })
    req.on("error", (err: Error) => reject(err))
    if (payload) req.write(payload)
    req.end()
  })
}

describe("Template Evolution Flow (full HTTP)", () => {
  const TPL_ID = "tpl-evo-int"
  let registry: TemplateRegistry

  beforeAll(() => {
    process.env.ARELY_API_KEY = "test-key"
    loadConfig()
    const db = createInMemoryDb()
    for (const stmt of CREATE_TABLES) {
      db.sqlite.exec(stmt)
    }
    for (const stmt of MIGRATIONS) {
      try { db.sqlite.exec(stmt) } catch { /* already applied */ }
    }
    for (const idx of CREATE_INDEXES) {
      try { db.sqlite.exec(idx) } catch { /* already exists */ }
    }
    connect(":memory:")
    registry = new TemplateRegistry()
    makeTemplate(registry, TPL_ID)
  })

  afterAll(() => {
    close()
  })

  async function withServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
    const sse = new SSEBus()
    const server = createHttpServer({
      sse,
      port: 0,
      middleware: [bodyParser("1mb", [])],
      setupRoutes: (router) => {
        registerEvolutionRoutes(router, registry, MOCK_ADAPTER, sse)
      },
    })
    try {
      const port = await listenOnRandomPort(server)
      return await fn(port)
    } finally {
      server.close()
    }
  }

  it("creates, approves, and applies a proposal end-to-end", async () => {
    await withServer(async (port) => {
      const base = `http://localhost:${port}/api/flow`

      const createResp = await postJson(
        `${base}/evolution/proposals`,
        {
          templateId: TPL_ID,
          type: "parameter_change",
          parameter: "interval",
          currentValue: "60",
          suggestedValue: "300",
          confidence: 0.85,
          evidence: { executions: 30, successRate: 0.9 },
        },
      )
      expect(createResp.statusCode).toBe(201)
      const created = JSON.parse(createResp.body)
      expect(created.status).toBe("draft")

      const approveResp = await postJson(
        `${base}/evolution/proposals/${created.id}/approve`,
      )
      expect(approveResp.statusCode).toBe(200)
      const approved = JSON.parse(approveResp.body)
      expect(approved.status).toBe("approved")

      const applyResp = await postJson(
        `${base}/evolution/proposals/${created.id}/apply`,
      )
      expect(applyResp.statusCode).toBe(200)
      const result = JSON.parse(applyResp.body)
      expect(result.templateId).toBe(TPL_ID)
      expect(result.proposalId).toBe(created.id)
      expect(result.oldVersion).toBe("1.0.0")
      expect(result.newVersion).toBe("1.1.0")
      expect(result.parameter).toBe("interval")
      expect(result.oldValue).toBe(60)
      expect(result.newValue).toBe(300)

      const updated = registry.get(TPL_ID)
      expect(updated!.metadata.templateVersion).toBe("1.1.0")
      const intervalParam = updated!.metadata.parameters.find((p: { name: string }) => p.name === "interval")
      expect(intervalParam!.default).toBe(300)
    })
  })

  it("returns 422 when applying a draft proposal", async () => {
    await withServer(async (port) => {
      const base = `http://localhost:${port}/api/flow`

      const createResp = await postJson(
        `${base}/evolution/proposals`,
        {
          templateId: TPL_ID,
          type: "parameter_change",
          parameter: "timeout",
          currentValue: "1000",
          suggestedValue: "5000",
          confidence: 0.75,
          evidence: { executions: 25, successRate: 0.8 },
        },
      )
      expect(createResp.statusCode).toBe(201)
      const created = JSON.parse(createResp.body)

      const applyResp = await postJson(
        `${base}/evolution/proposals/${created.id}/apply`,
      )
      expect(applyResp.statusCode).toBe(422)
    })
  })

  it("verifies the template was actually mutated after evolution", async () => {
    const updated = registry.get(TPL_ID)
    expect(updated).not.toBeNull()
    expect(updated!.metadata.templateVersion).toBe("1.1.0")
    const intervalParam = updated!.metadata.parameters.find((p: { name: string }) => p.name === "interval")
    expect(intervalParam!.default).toBe(300)
  })
})
