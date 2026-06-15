import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { TemplateRegistry } from "@arely/engine/templates/template-registry.js"
import { registerEvolutionRoutes } from "@arely/engine/compiler/evolution-routes.js"
import { createHttpServer } from "@arely/engine/transport/http-server.js"
import { SSEBus } from "@arely/engine/server/sse.js"
import { loadConfig } from "@arely/engine/config/index.js"
import { connect, close, createInMemoryDb } from "@arely/engine/persistence/database.js"
import { CREATE_TABLES, MIGRATIONS, CREATE_INDEXES } from "@arely/engine/persistence/migrate.js"
import { createFeedback } from "@arely/engine/persistence/feedback-store.js"
import { bodyParser } from "@arely/engine/transport/middleware.js"
import http from "node:http"

const MOCK_ADAPTER = {
  createSession: () => "mock-session-id",
  runSession: async () => ({ content: "mock", toolCalls: [] }),
} as never

function listenOnRandomPort(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address()
      resolve(typeof addr === "object" ? addr!.port : 0)
    })
  })
}

function get(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = ""
      res.on("data", (chunk: string) => { body += chunk })
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }))
    })
    req.on("error", (err: Error) => reject(err))
  })
}

function post(url: string, data?: unknown): Promise<{ statusCode: number; body: string }> {
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

describe("Structural Proposal Lifecycle (full HTTP)", () => {
  let registry: TemplateRegistry

  beforeAll(() => {
    process.env.ARELY_API_KEY = "test-key"
    loadConfig()
    const db = createInMemoryDb()
    for (const stmt of CREATE_TABLES) {
      db.sqlite.exec(stmt)
    }
    for (const stmt of MIGRATIONS) {
      try { db.sqlite.exec(stmt) } catch { }
    }
    for (const idx of CREATE_INDEXES) {
      try { db.sqlite.exec(idx) } catch { }
    }
    connect(":memory:")
    registry = new TemplateRegistry()

    registry.registerInline({
      metadata: { id: "tpl-single", name: "Single", description: "", category: "default", tags: [], templateVersion: "1.0.0", author: "Test", parameters: [], requires: [], source: "builtin" },
      workflowDsl: "",
      workflowObj: { name: "single", steps: [{ id: "s1", type: "http" }], trigger: { type: "manual" } },
    })

    registry.registerInline({
      metadata: { id: "tpl-chain", name: "Chain", description: "", category: "default", tags: [], templateVersion: "1.0.0", author: "Test", parameters: [], requires: [], source: "builtin" },
      workflowDsl: "",
      workflowObj: { name: "chain", steps: [{ id: "s1", type: "http", next: "s2" }, { id: "s2", type: "llm" }], trigger: { type: "webhook" } },
    })

    registry.registerInline({
      metadata: { id: "tpl-retry", name: "Retry", description: "", category: "default", tags: [], templateVersion: "1.0.0", author: "Test", parameters: [], requires: [], source: "builtin" },
      workflowDsl: "",
      workflowObj: { name: "retry", steps: [{ id: "s1", type: "http", onFailure: { retry: { maxAttempts: 3 } } }], trigger: { type: "manual" } },
    })

    // Seed feedback to meet thresholds
    for (let i = 0; i < 30; i++) {
      createFeedback({ workflowId: `w-chain-${i}`, templateId: "tpl-chain", source: "template", success: true })
      createFeedback({ workflowId: `w-retry-${i}`, templateId: "tpl-retry", source: "template", success: true })
    }
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

  it("POST /api/flow/structural/proposals creates persisted proposals", async () => {
    await withServer(async (port) => {
      const res = await post(`http://localhost:${port}/api/flow/structural/proposals`, { templateId: "tpl-single" })
      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.body)
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBeGreaterThan(0)
      for (const p of body) {
        expect(p.id).toBeTruthy()
        expect(p.templateId).toBe("tpl-single")
        expect(p.type).toBe("structural")
        expect(p.status).toBe("draft")
      }
    })
  })

  it("GET /api/flow/structural/proposals lists structural proposals", async () => {
    await withServer(async (port) => {
      await post(`http://localhost:${port}/api/flow/structural/proposals`, { templateId: "tpl-single" })
      const res = await get(`http://localhost:${port}/api/flow/structural/proposals`)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBeGreaterThan(0)
      for (const p of body) {
        expect(p.type).toBe("structural")
      }
    })
  })

  it("GET /api/flow/structural/proposals/:id returns a single proposal", async () => {
    await withServer(async (port) => {
      const createRes = await post(`http://localhost:${port}/api/flow/structural/proposals`, { templateId: "tpl-single" })
      const created = JSON.parse(createRes.body)
      const id = created[0].id

      const res = await get(`http://localhost:${port}/api/flow/structural/proposals/${id}`)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.id).toBe(id)
      expect(body.templateId).toBe("tpl-single")
    })
  })

  it("POST /api/flow/structural/proposals/:id/approve updates status to approved", async () => {
    await withServer(async (port) => {
      const createRes = await post(`http://localhost:${port}/api/flow/structural/proposals`, { templateId: "tpl-single" })
      const created = JSON.parse(createRes.body)
      const id = created[0].id

      const res = await post(`http://localhost:${port}/api/flow/structural/proposals/${id}/approve`)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.id).toBe(id)
      expect(body.status).toBe("approved")
    })
  })

  it("POST /api/flow/structural/proposals/:id/reject updates status to rejected", async () => {
    await withServer(async (port) => {
      const createRes = await post(`http://localhost:${port}/api/flow/structural/proposals`, { templateId: "tpl-single" })
      const created = JSON.parse(createRes.body)
      const id = created[0].id

      const res = await post(`http://localhost:${port}/api/flow/structural/proposals/${id}/reject`)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.id).toBe(id)
      expect(body.status).toBe("rejected")
    })
  })

  it("POST with missing templateId returns 400", async () => {
    await withServer(async (port) => {
      const res = await post(`http://localhost:${port}/api/flow/structural/proposals`, {})
      expect(res.statusCode).toBe(400)
    })
  })

  it("GET non-existent proposal returns 404", async () => {
    await withServer(async (port) => {
      const res = await get(`http://localhost:${port}/api/flow/structural/proposals/nonexistent-id`)
      expect(res.statusCode).toBe(404)
    })
  })
})
