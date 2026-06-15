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

describe("Structural Evolution Proposals (full HTTP)", () => {
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

    registry.registerInline({
      metadata: { id: "tpl-eh", name: "EH", description: "", category: "default", tags: [], templateVersion: "1.0.0", author: "Test", parameters: [], requires: [], source: "builtin" },
      workflowDsl: "",
      workflowObj: { name: "eh", steps: [{ id: "s1", type: "transform", onFailure: { fallback: "s2" } }, { id: "s2", type: "log" }], trigger: { type: "manual" } },
    })

    registry.registerInline({
      metadata: { id: "tpl-param", name: "Param", description: "", category: "default", tags: [], templateVersion: "1.0.0", author: "Test", parameters: [{ name: "url", label: "URL", type: "string" }], requires: [], source: "builtin" },
      workflowDsl: "",
      workflowObj: { name: "param", steps: [{ id: "s1", type: "http" }], trigger: { type: "manual" } },
    })

    // Seed feedback — enough to meet thresholds (20+ per pattern)
    for (let i = 0; i < 30; i++) {
      createFeedback({
        workflowId: `w-chain-${i}`,
        templateId: "tpl-chain",
        source: "template",
        success: true,
      })
      createFeedback({
        workflowId: `w-retry-${i}`,
        templateId: "tpl-retry",
        source: "template",
        success: true,
      })
      createFeedback({
        workflowId: `w-eh-${i}`,
        templateId: "tpl-eh",
        source: "template",
        success: i < 27,
      })
      createFeedback({
        workflowId: `w-param-${i}`,
        templateId: "tpl-param",
        source: "template",
        success: true,
      })
      createFeedback({
        workflowId: `w-single-${i}`,
        templateId: "tpl-single",
        source: "template",
        success: i < 18,
      })
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

  it("GET /api/flow/structural/proposals/ephemeral returns proposals array", async () => {
    await withServer(async (port) => {
      const res = await get(`http://localhost:${port}/api/flow/structural/proposals/ephemeral`)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(Array.isArray(body)).toBe(true)
    })
  })

  it("ephemeral proposals have correct shape", async () => {
    await withServer(async (port) => {
      const res = await get(`http://localhost:${port}/api/flow/structural/proposals/ephemeral`)
      const body = JSON.parse(res.body)
      if (body.length > 0) {
        const p = body[0]
        expect(p).toHaveProperty("id")
        expect(p).toHaveProperty("templateId")
        expect(p).toHaveProperty("kind")
        expect(p).toHaveProperty("title")
        expect(p).toHaveProperty("description")
        expect(p).toHaveProperty("confidence")
        expect(p).toHaveProperty("evidence")
        expect(p.evidence).toHaveProperty("pattern")
        expect(p.evidence).toHaveProperty("avgSuccessRate")
        expect(p.evidence).toHaveProperty("avgConfidence")
        expect(p.evidence).toHaveProperty("sampleExecutions")
        expect(p).toHaveProperty("rationale")
      }
    })
  })

  it("GET /api/flow/structural/proposals/ephemeral/:templateId filters by template", async () => {
    await withServer(async (port) => {
      const res = await get(`http://localhost:${port}/api/flow/structural/proposals/ephemeral/tpl-single`)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(Array.isArray(body)).toBe(true)
      for (const p of body) {
        expect(p.templateId).toBe("tpl-single")
      }
    })
  })

  it("non-existent template returns empty array", async () => {
    await withServer(async (port) => {
      const res = await get(`http://localhost:${port}/api/flow/structural/proposals/ephemeral/nonexistent`)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body).toEqual([])
    })
  })

  it("ephemeral proposals are sorted by confidence descending", async () => {
    await withServer(async (port) => {
      const res = await get(`http://localhost:${port}/api/flow/structural/proposals/ephemeral`)
      const body = JSON.parse(res.body)
      for (let i = 1; i < body.length; i++) {
        expect(body[i - 1].confidence).toBeGreaterThanOrEqual(body[i].confidence)
      }
    })
  })
})
