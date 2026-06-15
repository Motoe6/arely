import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { TemplateRegistry } from "@arely/engine/templates/template-registry.js"
import { registerEvolutionRoutes } from "@arely/engine/compiler/evolution-routes.js"
import { createHttpServer } from "@arely/engine/transport/http-server.js"
import { SSEBus } from "@arely/engine/server/sse.js"
import { loadConfig } from "@arely/engine/config/index.js"
import { connect, close, createInMemoryDb } from "@arely/engine/persistence/database.js"
import { CREATE_TABLES, MIGRATIONS, CREATE_INDEXES } from "@arely/engine/persistence/migrate.js"
import { bodyParser } from "@arely/engine/transport/middleware.js"
import { createProposal } from "@arely/engine/persistence/proposal-store.js"
import http from "node:http"

const MOCK_ADAPTER = {
  createSession: () => "mock-session-id",
  runSession: async () => ({ content: "mock", toolCalls: [] }),
} as never

function makeTemplate(registry: TemplateRegistry, id: string) {
  registry.registerInline({
    metadata: {
      id,
      name: "Audit Integration Test",
      description: "Template for audit integration tests",
      category: "test",
      tags: [],
      templateVersion: "1.0.0",
      author: "Test",
      parameters: [
        { name: "interval", label: "Interval", type: "number", default: 60, required: false },
        { name: "timeout", label: "Timeout", type: "number", default: 1000, required: false },
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

function getUrl(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ""
      res.on("data", (chunk: string) => { body += chunk })
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }))
    }).on("error", (err: Error) => reject(err))
  })
}

describe("Evolution Audit Integration", () => {
  const TPL_ID = "tpl-audit-int"
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

  it("creates an audit record when a proposal is applied", async () => {
    await withServer(async (port) => {
      const base = `http://localhost:${port}/api/flow`

      const createResp = await postJson(`${base}/evolution/proposals`, {
        templateId: TPL_ID,
        type: "parameter_change",
        parameter: "interval",
        currentValue: "60",
        suggestedValue: "300",
        confidence: 0.85,
        evidence: { executions: 30, successRate: 0.9 },
      })
      expect(createResp.statusCode).toBe(201)
      const proposal = JSON.parse(createResp.body)

      await postJson(`${base}/evolution/proposals/${proposal.id}/approve`)
      await postJson(`${base}/evolution/proposals/${proposal.id}/apply`)

      const auditResp = await getUrl(`${base}/evolution/audit/proposal/${proposal.id}`)
      expect(auditResp.statusCode).toBe(200)
      const audit = JSON.parse(auditResp.body)

      expect(audit.templateId).toBe(TPL_ID)
      expect(audit.proposalId).toBe(proposal.id)
      expect(audit.parameter).toBe("interval")
      expect(audit.oldValue).toBe("60")
      expect(audit.newValue).toBe("300")
      expect(audit.approvedBy).toBeNull()
      expect(audit.proposalTitle).toBe("interval: 300")
      expect(audit.evidenceSnapshot).toEqual({
        executions: 30,
        successRate: 0.9,
        confidence: 0.85,
        score: 0.85,
      })
    })
  })

  it("lists audit records for a template after evolution", async () => {
    await withServer(async (port) => {
      const base = `http://localhost:${port}/api/flow`

      const createResp = await postJson(`${base}/evolution/proposals`, {
        templateId: TPL_ID,
        type: "parameter_change",
        parameter: "timeout",
        currentValue: "1000",
        suggestedValue: "5000",
        confidence: 0.72,
        evidence: { executions: 22, successRate: 0.86 },
      })
      expect(createResp.statusCode).toBe(201)
      const proposal = JSON.parse(createResp.body)

      await postJson(`${base}/evolution/proposals/${proposal.id}/approve`)
      await postJson(`${base}/evolution/proposals/${proposal.id}/apply`)

      const auditResp = await getUrl(`${base}/evolution/audit/template/${TPL_ID}`)
      expect(auditResp.statusCode).toBe(200)
      const records = JSON.parse(auditResp.body)
      expect(records.length).toBeGreaterThanOrEqual(2)

      const timeoutAudit = records.find((r: { parameter: string }) => r.parameter === "timeout")
      expect(timeoutAudit).toBeDefined()
      expect(timeoutAudit.oldValue).toBe("1000")
      expect(timeoutAudit.newValue).toBe("5000")
    })
  })

  it("returns 404 for nonexistent proposal audit", async () => {
    await withServer(async (port) => {
      const auditResp = await getUrl(
        `http://localhost:${port}/api/flow/evolution/audit/proposal/nonexistent`,
      )
      expect(auditResp.statusCode).toBe(404)
    })
  })

  it("lists all audit records with global endpoint", async () => {
    await withServer(async (port) => {
      const auditResp = await getUrl(
        `http://localhost:${port}/api/flow/evolution/audit`,
      )
      expect(auditResp.statusCode).toBe(200)
      const records = JSON.parse(auditResp.body)
      expect(records.length).toBeGreaterThanOrEqual(2)
    })
  })

  it("filters global audit by templateId", async () => {
    await withServer(async (port) => {
      const auditResp = await getUrl(
        `http://localhost:${port}/api/flow/evolution/audit?templateId=${TPL_ID}`,
      )
      expect(auditResp.statusCode).toBe(200)
      const records = JSON.parse(auditResp.body)
      for (const r of records) {
        expect(r.templateId).toBe(TPL_ID)
      }
    })
  })
})
