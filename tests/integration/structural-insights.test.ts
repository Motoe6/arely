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

function makeTemplate(registry: TemplateRegistry, id: string, category: string, steps: Record<string, unknown>[], triggerType = "manual", parameters: Array<{ name: string; label: string; type: string }> = []) {
  const isDyn = id === "tpl-dyn"
  registry.registerInline({
    metadata: {
      id,
      name: isDyn ? "{{ param:name }}" : "Test",
      description: "",
      category,
      tags: [],
      templateVersion: "1.0.0",
      author: "Test",
      parameters: parameters as any,
      requires: [],
      source: "builtin",
    },
    workflowDsl: "",
    workflowObj: { name: isDyn ? "{{ param:name }}" : "test", steps, trigger: { type: triggerType } },
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

function makeRequest(url: string, method = "GET", data?: unknown): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : undefined
    const req = http.request(url, {
      method,
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

describe("Structural Insights (full HTTP)", () => {
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
    makeTemplate(registry, "tpl-single", "networking", [{ id: "s1", type: "http" }])
    makeTemplate(registry, "tpl-chain", "ai", [
      { id: "s1", type: "http", next: "s2" },
      { id: "s2", type: "llm" },
    ], "webhook")
    makeTemplate(registry, "tpl-retry", "networking", [
      { id: "s1", type: "http", onFailure: { retry: { maxAttempts: 3 } } },
    ])
    makeTemplate(registry, "tpl-param", "data", [{ id: "s1", type: "transform" }], "schedule", [
      { name: "url", label: "URL", type: "string" },
    ])
    makeTemplate(registry, "tpl-dyn", "ai", [{ id: "s1", type: "llm" }], "manual", [
      { name: "query", label: "Query", type: "string" },
    ])
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

  it("GET /api/flow/structural/insights returns patterns and insights", async () => {
    await withServer(async (port) => {
      const res = await makeRequest(`http://localhost:${port}/api/flow/structural/insights`)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)

      expect(body).toHaveProperty("overall")
      expect(body).toHaveProperty("byCategory")
      expect(Array.isArray(body.overall)).toBe(true)
      expect(typeof body.byCategory).toBe("object")
    })
  })

  it("detects single_step and multi_step_chain patterns", async () => {
    await withServer(async (port) => {
      const res = await makeRequest(`http://localhost:${port}/api/flow/structural/insights`)
      const body = JSON.parse(res.body)
      const patterns = body.overall.map((i: any) => i.pattern)

      expect(patterns).toContain("single_step")
      expect(patterns).toContain("multi_step_chain")
      expect(patterns).toContain("http_llm_chain")
      expect(patterns).toContain("webhook_trigger")
      expect(patterns).toContain("schedule_trigger")
      expect(patterns).toContain("has_retry_config")
      expect(patterns).toContain("has_onfailure_handling")
      expect(patterns).toContain("parameterized")
      expect(patterns).toContain("dynamic_name")
    })
  })

  it("reports correct frequency and totalTemplates", async () => {
    await withServer(async (port) => {
      const res = await makeRequest(`http://localhost:${port}/api/flow/structural/insights`)
      const body = JSON.parse(res.body)

      const single = body.overall.find((i: any) => i.pattern === "single_step")
      expect(single.frequency).toBe(4)
      expect(single.totalTemplates).toBe(5)

      const param = body.overall.find((i: any) => i.pattern === "parameterized")
      expect(param.frequency).toBe(2)
    })
  })

  it("reports byCategory with category-specific insights", async () => {
    await withServer(async (port) => {
      const res = await makeRequest(`http://localhost:${port}/api/flow/structural/insights`)
      const body = JSON.parse(res.body)

      expect(body.byCategory).toHaveProperty("networking")
      expect(body.byCategory).toHaveProperty("ai")
      expect(body.byCategory).toHaveProperty("data")
    })
  })

  it("reports sampleExecutions even with no feedback", async () => {
    await withServer(async (port) => {
      const res = await makeRequest(`http://localhost:${port}/api/flow/structural/insights`)
      const body = JSON.parse(res.body)

      for (const insight of body.overall) {
        expect(insight).toHaveProperty("sampleExecutions")
        expect(insight).toHaveProperty("avgSuccessRate")
        expect(insight).toHaveProperty("avgConfidence")
      }
    })
  })

  it("reports frequencyPct as percentage", async () => {
    await withServer(async (port) => {
      const res = await makeRequest(`http://localhost:${port}/api/flow/structural/insights`)
      const body = JSON.parse(res.body)

      for (const insight of body.overall) {
        expect(insight.frequencyPct).toBeGreaterThanOrEqual(0)
        expect(insight.frequencyPct).toBeLessThanOrEqual(100)
      }
    })
  })
})
