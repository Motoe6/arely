import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { TemplateRegistry } from "@arelyos/engine/templates/template-registry.js"
import { registerEvolutionRoutes } from "@arelyos/engine/compiler/evolution-routes.js"
import { createHttpServer } from "@arelyos/engine/transport/http-server.js"
import { SSEBus } from "@arelyos/engine/server/sse.js"
import { loadConfig } from "@arelyos/engine/config/index.js"
import { connect, close, createInMemoryDb } from "@arelyos/engine/persistence/database.js"
import { CREATE_TABLES, MIGRATIONS, CREATE_INDEXES } from "@arelyos/engine/persistence/migrate.js"
import { createFeedback } from "@arelyos/engine/persistence/feedback-store.js"
import { bodyParser } from "@arelyos/engine/transport/middleware.js"
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

describe("Structural Evolution Lifecycle (full HTTP)", () => {
  let registry: TemplateRegistry

  beforeAll(() => {
    process.env.ARELY_API_KEY = "test-key"
    loadConfig()
    const db = createInMemoryDb()
    for (const stmt of CREATE_TABLES) { db.sqlite.exec(stmt) }
    for (const stmt of MIGRATIONS) { try { db.sqlite.exec(stmt) } catch { } }
    for (const idx of CREATE_INDEXES) { try { db.sqlite.exec(idx) } catch { } }
    connect(":memory:")
    registry = new TemplateRegistry()

    registry.registerInline({
      metadata: { id: "tpl-single", name: "Single", description: "", category: "default", tags: [], templateVersion: "1.0.0", author: "Test", parameters: [], requires: [], source: "builtin" },
      workflowDsl: "", workflowObj: { name: "single", steps: [{ id: "s1", type: "http" }], trigger: { type: "manual" } },
    })
    registry.registerInline({
      metadata: { id: "tpl-chain", name: "Chain", description: "", category: "default", tags: [], templateVersion: "1.0.0", author: "Test", parameters: [], requires: [], source: "builtin" },
      workflowDsl: "", workflowObj: { name: "chain", steps: [{ id: "s1", type: "http", next: "s2" }, { id: "s2", type: "llm" }], trigger: { type: "webhook" } },
    })
    registry.registerInline({
      metadata: { id: "tpl-retry", name: "Retry", description: "", category: "default", tags: [], templateVersion: "1.0.0", author: "Test", parameters: [], requires: [], source: "builtin" },
      workflowDsl: "", workflowObj: { name: "retry", steps: [{ id: "s1", type: "http", onFailure: { retry: { maxAttempts: 3 } } }], trigger: { type: "manual" } },
    })
    registry.registerInline({
      metadata: { id: "tpl-eh", name: "EH", description: "", category: "default", tags: [], templateVersion: "1.0.0", author: "Test", parameters: [], requires: [], source: "builtin" },
      workflowDsl: "", workflowObj: { name: "eh", steps: [{ id: "s1", type: "transform", onFailure: { fallback: "s2" } }, { id: "s2", type: "log" }], trigger: { type: "manual" } },
    })
    registry.registerInline({
      metadata: { id: "tpl-param", name: "Param", description: "", category: "default", tags: [], templateVersion: "1.0.0", author: "Test", parameters: [{ name: "url", label: "URL", type: "string" }], requires: [], source: "builtin" },
      workflowDsl: "", workflowObj: { name: "param", steps: [{ id: "s1", type: "http" }], trigger: { type: "manual" } },
    })

    // Seed feedback to meet thresholds (20+ per pattern)
    for (let i = 0; i < 30; i++) {
      createFeedback({ workflowId: `w-chain-${i}`, templateId: "tpl-chain", source: "template", success: true })
      createFeedback({ workflowId: `w-retry-${i}`, templateId: "tpl-retry", source: "template", success: true })
      createFeedback({ workflowId: `w-eh-${i}`, templateId: "tpl-eh", source: "template", success: i < 27 })
      createFeedback({ workflowId: `w-param-${i}`, templateId: "tpl-param", source: "template", success: true })
      createFeedback({ workflowId: `w-single-${i}`, templateId: "tpl-single", source: "template", success: i < 18 })
    }
  })

  afterAll(() => { close() })

  async function withServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
    const sse = new SSEBus()
    const server = createHttpServer({
      sse, port: 0,
      middleware: [bodyParser("1mb", [])],
      setupRoutes: (router) => { registerEvolutionRoutes(router, registry, MOCK_ADAPTER, sse) },
    })
    try {
      const port = await listenOnRandomPort(server)
      return await fn(port)
    } finally { server.close() }
  }

  it("full lifecycle: create → approve → apply → verify mutation", async () => {
    await withServer(async (port) => {
      // Create structural proposals
      const createRes = await post(`http://localhost:${port}/api/flow/structural/proposals`, { templateId: "tpl-single" })
      expect(createRes.statusCode).toBe(201)
      const created = JSON.parse(createRes.body)
      expect(Array.isArray(created)).toBe(true)
      expect(created.length).toBeGreaterThan(0)
      const proposal = created[0]
      expect(proposal.status).toBe("draft")

      // Approve the proposal
      const approveRes = await post(`http://localhost:${port}/api/flow/structural/proposals/${proposal.id}/approve`)
      expect(approveRes.statusCode).toBe(200)
      const approved = JSON.parse(approveRes.body)
      expect(approved.status).toBe("approved")

      // Apply the proposal
      const applyRes = await post(`http://localhost:${port}/api/flow/structural/proposals/${proposal.id}/apply`)
      expect(applyRes.statusCode).toBe(200)
      const result = JSON.parse(applyRes.body)
      expect(result.templateId).toBe("tpl-single")
      expect(result.oldVersion).toBe("1.0.0")
      expect(result.newVersion).toBe("1.1.0")
      expect(result.kind).toBeTruthy()
      expect(Array.isArray(result.changes)).toBe(true)

      // Verify template was mutated in registry
      const getProposalRes = await get(`http://localhost:${port}/api/flow/structural/proposals/${proposal.id}`)
      expect(getProposalRes.statusCode).toBe(200)
      const stored = JSON.parse(getProposalRes.body)
      expect(stored.status).toBe("applied")
    })
  })

  it("apply non-existent proposal returns 422", async () => {
    await withServer(async (port) => {
      const res = await post(`http://localhost:${port}/api/flow/structural/proposals/nonexistent-id/apply`)
      expect(res.statusCode).toBe(422)
      const body = JSON.parse(res.body)
      expect(body.error).toContain("Proposal not found")
    })
  })

  it("apply non-approved proposal returns 422", async () => {
    await withServer(async (port) => {
      // Create but don't approve
      const createRes = await post(`http://localhost:${port}/api/flow/structural/proposals`, { templateId: "tpl-single" })
      const created = JSON.parse(createRes.body)
      const proposal = created[0]

      const res = await post(`http://localhost:${port}/api/flow/structural/proposals/${proposal.id}/apply`)
      expect(res.statusCode).toBe(422)
      const body = JSON.parse(res.body)
      expect(body.error).toContain("status is \"draft\"")
    })
  })

  it("audit: GET /api/flow/structural/audit returns list", async () => {
    await withServer(async (port) => {
      // Create and approve and apply
      const createRes = await post(`http://localhost:${port}/api/flow/structural/proposals`, { templateId: "tpl-single" })
      const created = JSON.parse(createRes.body)
      await post(`http://localhost:${port}/api/flow/structural/proposals/${created[0].id}/approve`)
      await post(`http://localhost:${port}/api/flow/structural/proposals/${created[0].id}/apply`)

      const res = await get(`http://localhost:${port}/api/flow/structural/audit`)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(Array.isArray(body)).toBe(true)
    })
  })

  it("audit: GET /api/flow/structural/audit/template/:templateId returns records", async () => {
    await withServer(async (port) => {
      // Use a different template to avoid mutation side effects from previous tests
      const createRes = await post(`http://localhost:${port}/api/flow/structural/proposals`, { templateId: "tpl-param" })
      expect(createRes.statusCode).toBe(201)
      const created = JSON.parse(createRes.body)
      expect(created.length).toBeGreaterThan(0)
      await post(`http://localhost:${port}/api/flow/structural/proposals/${created[0].id}/approve`)
      await post(`http://localhost:${port}/api/flow/structural/proposals/${created[0].id}/apply`)

      const res = await get(`http://localhost:${port}/api/flow/structural/audit/template/tpl-param`)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(Array.isArray(body)).toBe(true)
      for (const r of body) {
        expect(r.templateId).toBe("tpl-param")
      }
    })
  })

  it("audit: GET /api/flow/structural/audit/proposal/:proposalId returns record", async () => {
    await withServer(async (port) => {
      const createRes = await post(`http://localhost:${port}/api/flow/structural/proposals`, { templateId: "tpl-param" })
      expect(createRes.statusCode).toBe(201)
      const created = JSON.parse(createRes.body)
      expect(created.length).toBeGreaterThan(0)
      await post(`http://localhost:${port}/api/flow/structural/proposals/${created[0].id}/approve`)
      await post(`http://localhost:${port}/api/flow/structural/proposals/${created[0].id}/apply`)

      const res = await get(`http://localhost:${port}/api/flow/structural/audit/proposal/${created[0].id}`)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.proposalId).toBe(created[0].id)
      expect(body.templateId).toBe("tpl-param")
    })
  })

  it("audit: missing proposal returns 404", async () => {
    await withServer(async (port) => {
      const res = await get(`http://localhost:${port}/api/flow/structural/audit/proposal/nonexistent-id`)
      expect(res.statusCode).toBe(404)
    })
  })
})
