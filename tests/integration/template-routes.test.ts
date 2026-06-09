import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { TemplateRegistry } from "@opencode/engine/templates/template-registry.js"
import { registerTemplateRoutes } from "@opencode/engine/templates/template-routes.js"
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
import { createWorkflow, createWorkflowVersion } from "@opencode/engine/persistence/workflow-store.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const BUILTIN_DIR = join(__dirname, "..", "..", "packages", "engine", "templates")

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

  userDir = mkdtempSync(join(tmpdir(), "user-templates-"))
})

afterAll(() => {
  globalNodeRegistry.unregister("http")
  globalNodeRegistry.unregister("llm")
  rmSync(userDir, { recursive: true, force: true })
  close()
})

function listenOnRandomPort(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address()
      resolve(typeof addr === "object" ? addr!.port : 0)
    })
  })
}

function fetchUrl(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ""
      res.on("data", (chunk: string) => { body += chunk })
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }))
    }).on("error", (err: Error) => reject(err))
  })
}

function requestJson(method: string, url: string, data?: unknown): Promise<{ statusCode: number; body: string }> {
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
    if (payload) { req.write(payload) }
    req.end()
  })
}

function postJson(url: string, data: unknown): Promise<{ statusCode: number; body: string }> {
  return requestJson("POST", url, data)
}

function putJson(url: string, data: unknown): Promise<{ statusCode: number; body: string }> {
  return requestJson("PUT", url, data)
}

function deleteReq(url: string): Promise<{ statusCode: number; body: string }> {
  return requestJson("DELETE", url)
}

async function withServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const sse = new SSEBus()
  const server = createHttpServer({
    sse,
    port: 0,
    middleware: [bodyParser("1mb", [])],
    setupRoutes: (router) => {
      registerTemplateRoutes(router, registry, BUILTIN_DIR, userDir)
    },
  })
  try {
    const port = await listenOnRandomPort(server)
    return await fn(port)
  } finally {
    server.close()
  }
}

describe("Template Routes", () => {
  describe("GET /api/flow/templates", () => {
    it("returns all 7 built-in templates", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await fetchUrl(`http://localhost:${port}/api/flow/templates`)
        expect(statusCode).toBe(200)
        const data = JSON.parse(body)
        expect(data).toHaveLength(7)
        expect(data.map((t: { id: string }) => t.id)).toContain("webhook-relay")
        expect(data.map((t: { id: string }) => t.id)).toContain("llm-query")
      })
    })

    it("filters by category", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await fetchUrl(`http://localhost:${port}/api/flow/templates?category=ai`)
        expect(statusCode).toBe(200)
        const data = JSON.parse(body)
        expect(data.length).toBeGreaterThanOrEqual(2)
        for (const t of data) {
          expect(t.category).toBe("ai")
        }
      })
    })

    it("filters by tag", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await fetchUrl(`http://localhost:${port}/api/flow/templates?tag=webhook`)
        expect(statusCode).toBe(200)
        const data = JSON.parse(body)
        expect(data.length).toBeGreaterThanOrEqual(2)
        for (const t of data) {
          expect(t.tags).toContain("webhook")
        }
      })
    })
  })

  describe("GET /api/flow/templates/categories", () => {
    it("returns sorted list of categories", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await fetchUrl(`http://localhost:${port}/api/flow/templates/categories`)
        expect(statusCode).toBe(200)
        const data = JSON.parse(body)
        expect(data).toContain("ai")
        expect(data).toContain("communication")
        expect(data).toContain("integration")
        expect(data).toContain("monitoring")
        expect(data).toEqual([...data].sort())
      })
    })
  })

  describe("GET /api/flow/templates/:id", () => {
    it("returns metadata, workflowDsl, and readme for a valid template", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await fetchUrl(`http://localhost:${port}/api/flow/templates/webhook-relay`)
        expect(statusCode).toBe(200)
        const data = JSON.parse(body)
        expect(data.metadata).toBeDefined()
        expect(data.metadata.id).toBe("webhook-relay")
        expect(data.workflowDsl).toBeDefined()
        expect(data.workflowDsl).toContain("{{ param:")
        expect(data.readme).toBeDefined()
        expect(data.readme).toContain("Webhook Relay")
      })
    })

    it("returns 404 for nonexistent template", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await fetchUrl(`http://localhost:${port}/api/flow/templates/nonexistent`)
        expect(statusCode).toBe(404)
        const data = JSON.parse(body)
        expect(data.error.code).toBe("TEMPLATE_NOT_FOUND")
      })
    })
  })

  describe("POST /api/flow/templates/:id/instantiate", () => {
    it("returns a valid workflow with minimal params", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/templates/webhook-relay/instantiate`,
          { params: { target_url: "https://example.com/hook" } },
        )
        expect(statusCode).toBe(200)
        const data = JSON.parse(body)
        expect(data.workflow).toBeDefined()
        expect(data.workflow.id).toBeTruthy()
        expect(data.workflow.steps.length).toBeGreaterThan(0)
        expect(data.workflow.metadata?.template).toBeDefined()
        expect(data.metadata.templateId).toBe("webhook-relay")
        expect(data.metadata.templateVersion).toBe("1.0.0")
        const json = JSON.stringify(data.workflow)
        expect(json).not.toContain("{{param:")
      })
    })

    it("returns 400 for missing required param", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/templates/webhook-relay/instantiate`,
          { params: {} },
        )
        expect(statusCode).toBe(400)
        const data = JSON.parse(body)
        expect(data.error.code).toBe("TEMPLATE_VALIDATION_ERROR")
      })
    })

    it("returns 404 for nonexistent template", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/templates/nonexistent/instantiate`,
          { params: {} },
        )
        expect(statusCode).toBe(404)
        const data = JSON.parse(body)
        expect(data.error.code).toBe("TEMPLATE_NOT_FOUND")
      })
    })

    it("returns 400 when required llm node is not available", async () => {
      globalNodeRegistry.unregister("llm")
      try {
        const { statusCode, body } = await withServer(async (port) => {
          return postJson(
            `http://localhost:${port}/api/flow/templates/llm-query/instantiate`,
            { params: { prompt_template: "hello" } },
          )
        })
        expect(statusCode).toBe(400)
        const data = JSON.parse(body)
        expect(data.error.code).toBe("MISSING_NODE_REQUIREMENT")
      } finally {
        globalNodeRegistry.register(LLMNode)
      }
    })

    it("instantiates a multi-step template (api-chain)", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/templates/api-chain/instantiate`,
          { params: { first_url: "https://a.com/1", second_url: "https://b.com/2" } },
        )
        expect(statusCode).toBe(200)
        const data = JSON.parse(body)
        expect(data.workflow.steps).toHaveLength(2)
        expect(data.workflow.steps[0].next).toBe("second")
      })
    })
  })

  describe("POST /api/flow/templates — user template CRUD", () => {
    it("creates a user template with auto-generated id from name", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/templates`,
          {
            name: "My Health Check",
            description: "A health check template",
            category: "monitoring",
            tags: ["health", "monitoring"],
            workflowYaml: `version: "1.0.0"\nsteps:\n  - id: s1\n    type: http\n    input:\n      url: "{{ param:target_url }}"`,
            parameters: [
              { name: "target_url", label: "Target URL", type: "string", required: true },
            ],
            requires: ["http"],
          },
        )
        expect(statusCode).toBe(201)
        const data = JSON.parse(body)
        expect(data.id).toBe("my-health-check")
        expect(data.source).toBe("user")
        expect(data.name).toBe("My Health Check")
        expect(data.category).toBe("monitoring")
      })
    })

    it("creates a user template with explicit id", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/templates`,
          {
            id: "explicit-id",
            name: "Explicit",
            description: "Template with explicit id",
            category: "integration",
            workflowYaml: `version: "1.0.0"\nsteps:\n  - id: s1\n    type: echo`,
            requires: [],
          },
        )
        expect(statusCode).toBe(201)
        const data = JSON.parse(body)
        expect(data.id).toBe("explicit-id")
        expect(data.source).toBe("user")
      })
    })

    it("returns 409 for duplicate template id", async () => {
      await withServer(async (port) => {
        const payload = {
          id: "dup-test",
          name: "Dup Test",
          description: "Should conflict",
          category: "integration",
          workflowYaml: `version: "1.0.0"\nsteps:\n  - id: s1\n    type: echo`,
          requires: [],
        }
        const r1 = await postJson(`http://localhost:${port}/api/flow/templates`, payload)
        expect(r1.statusCode).toBe(201)
        const r2 = await postJson(`http://localhost:${port}/api/flow/templates`, payload)
        expect(r2.statusCode).toBe(409)
        const data = JSON.parse(r2.body)
        expect(data.error).toContain("dup-test")
      })
    })

    it("returns 400 for missing required fields", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/templates`,
          { name: "Incomplete" },
        )
        expect(statusCode).toBe(400)
        const data = JSON.parse(body)
        expect(data.error).toContain("description")
      })
    })

    it("returns 422 for invalid workflow yaml", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/templates`,
          {
            name: "Bad YAML",
            description: "Invalid yaml template",
            category: "integration",
            workflowYaml: "not: valid: yaml: [broken",
            requires: [],
          },
        )
        expect(statusCode).toBe(422)
        const data = JSON.parse(body)
        expect(data.error).toBeDefined()
      })
    })
  })

  describe("PUT /api/flow/templates/:id", () => {
    it("updates a user template metadata", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await putJson(
          `http://localhost:${port}/api/flow/templates/my-health-check`,
          { description: "Updated description" },
        )
        expect(statusCode).toBe(200)
        const data = JSON.parse(body)
        expect(data.description).toBe("Updated description")
        expect(data.name).toBe("My Health Check")
      })
    })

    it("returns 403 for built-in template", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await putJson(
          `http://localhost:${port}/api/flow/templates/webhook-relay`,
          { description: "hack" },
        )
        expect(statusCode).toBe(403)
        const data = JSON.parse(body)
        expect(data.error).toContain("built-in")
      })
    })

    it("returns 404 for nonexistent template", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await putJson(
          `http://localhost:${port}/api/flow/templates/nonexistent`,
          { description: "nope" },
        )
        expect(statusCode).toBe(404)
        const data = JSON.parse(body)
        expect(data.error.code).toBe("TEMPLATE_NOT_FOUND")
      })
    })
  })

  describe("DELETE /api/flow/templates/:id", () => {
    it("deletes a user template", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await deleteReq(
          `http://localhost:${port}/api/flow/templates/explicit-id`,
        )
        expect(statusCode).toBe(200)
        const data = JSON.parse(body)
        expect(data.success).toBe(true)
      })
    })

    it("returns 403 for built-in template", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await deleteReq(
          `http://localhost:${port}/api/flow/templates/webhook-relay`,
        )
        expect(statusCode).toBe(403)
        const data = JSON.parse(body)
        expect(data.error).toContain("built-in")
      })
    })

    it("returns 404 for nonexistent template", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await deleteReq(
          `http://localhost:${port}/api/flow/templates/nonexistent`,
        )
        expect(statusCode).toBe(404)
        const data = JSON.parse(body)
        expect(data.error.code).toBe("TEMPLATE_NOT_FOUND")
      })
    })
  })

  describe("startup reload persistence", () => {
    it("reloads user templates from disk after restart", async () => {
      const freshRegistry = new TemplateRegistry()
      freshRegistry.reloadBuiltins(userDir, undefined, "user")
      const t = freshRegistry.get("my-health-check")
      expect(t).toBeDefined()
      expect(t!.metadata.source).toBe("user")
      expect(t!.metadata.name).toBe("My Health Check")
      expect(t!.metadata.description).toBe("Updated description")
      expect(t!.workflowDsl).toContain("target_url")
    })

    it("deleted template is absent after reload", async () => {
      const freshRegistry = new TemplateRegistry()
      freshRegistry.reloadBuiltins(userDir, undefined, "user")
      expect(freshRegistry.get("explicit-id")).toBeUndefined()
    })
  })

  describe("POST /api/flow/workflows/:id/save-as-template", () => {
    it("creates a user template from a workflow with body fields", async () => {
      const wf = createWorkflow({ name: "Save Test" })
      createWorkflowVersion(wf.id, JSON.stringify({
        id: "orig-id",
        name: "Original Name",
        version: "1.0.0",
        steps: [{ id: "s1", type: "http", input: { url: "https://example.com", method: "GET" } }],
      }), "active")

      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/workflows/${wf.id}/save-as-template`,
          {
            name: "Saved Workflow",
            description: "Saved via endpoint",
            category: "custom",
            tags: ["saved"],
            author: "Test User",
          },
        )
        expect(statusCode).toBe(201)
        const data = JSON.parse(body)
        expect(data.id).toBe("saved-workflow")
        expect(data.name).toBe("Saved Workflow")
        expect(data.description).toBe("Saved via endpoint")
        expect(data.category).toBe("custom")
        expect(data.tags).toEqual(["saved"])
        expect(data.author).toBe("Test User")
        expect(data.templateVersion).toBe("1.0.0")
        expect(data.source).toBe("user")
        expect(data.parameters).toEqual([])
        expect(data.requires).toEqual(["http"])
      })
    })

    it("falls back to workflow.name when body has no name", async () => {
      const wf = createWorkflow({ name: "Fallback Workflow" })
      createWorkflowVersion(wf.id, JSON.stringify({
        id: "fallback-id",
        name: "Workflow Name",
        version: "1.0.0",
        steps: [{ id: "s1", type: "echo" }],
      }), "active")

      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/workflows/${wf.id}/save-as-template`,
          {},
        )
        expect(statusCode).toBe(201)
        const data = JSON.parse(body)
        expect(data.id).toBe("workflow-name")
        expect(data.name).toBe("Workflow Name")
      })
    })

    it("returns 404 for nonexistent workflow", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/workflows/nonexistent-id/save-as-template`,
          { name: "Nope" },
        )
        expect(statusCode).toBe(404)
        const data = JSON.parse(body)
        expect(data.error.code).toBe("WORKFLOW_NOT_FOUND")
      })
    })

    it("returns 404 for workflow without current version", async () => {
      const wf = createWorkflow({ name: "No Version" })

      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/workflows/${wf.id}/save-as-template`,
          { name: "No Version" },
        )
        expect(statusCode).toBe(404)
        const data = JSON.parse(body)
        expect(data.error.code).toBe("WORKFLOW_NOT_FOUND")
      })
    })

    it("returns 409 for duplicate template id", async () => {
      const wf = createWorkflow({ name: "Dup Source" })
      createWorkflowVersion(wf.id, JSON.stringify({
        id: "dup-source",
        version: "1.0.0",
        steps: [{ id: "s1", type: "log" }],
      }), "active")

      await withServer(async (port) => {
        const r1 = await postJson(
          `http://localhost:${port}/api/flow/workflows/${wf.id}/save-as-template`,
          { name: "dup-save" },
        )
        expect(r1.statusCode).toBe(201)

        const r2 = await postJson(
          `http://localhost:${port}/api/flow/workflows/${wf.id}/save-as-template`,
          { name: "dup-save" },
        )
        expect(r2.statusCode).toBe(409)
        const data = JSON.parse(r2.body)
        expect(data.error).toContain("dup-save")
      })
    })

    it("detects requires from step types", async () => {
      const wf = createWorkflow({ name: "Requires Detection" })
      createWorkflowVersion(wf.id, JSON.stringify({
        id: "requires-test",
        version: "1.0.0",
        steps: [
          { id: "s1", type: "http", input: { url: "https://a.com", method: "GET" } },
          { id: "s2", type: "llm", input: { prompt: "hello" } },
          { id: "s3", type: "http", input: { url: "https://b.com", method: "POST" } },
        ],
      }), "active")

      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/workflows/${wf.id}/save-as-template`,
          { name: "Requires Check" },
        )
        expect(statusCode).toBe(201)
        const data = JSON.parse(body)
        expect(data.requires).toContain("http")
        expect(data.requires).toContain("llm")
        expect(data.requires).toHaveLength(2)
      })
    })

    it("sanitizes metadata.template and operational fields", async () => {
      const wf = createWorkflow({ name: "From Template" })
      createWorkflowVersion(wf.id, JSON.stringify({
        id: "template-origin",
        name: "From Builtin",
        version: "1.0.0",
        steps: [{ id: "s1", type: "http", input: { url: "https://example.com", method: "GET" } }],
        metadata: {
          template: { templateId: "builtin-abc", templateVersion: "1.0" },
          userNote: "keep me",
        },
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-06-01T00:00:00Z",
        executionStats: { runs: 42 },
        lastRun: "2025-06-01T00:00:00Z",
      }), "active")

      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/workflows/${wf.id}/save-as-template`,
          { name: "Sanitized Template" },
        )
        expect(statusCode).toBe(201)
        const data = JSON.parse(body)

        const t = registry.get(data.id)
        const obj = t!.workflowObj as Record<string, unknown>
        expect(obj.id).toBeUndefined()
        expect(obj.createdAt).toBeUndefined()
        expect(obj.updatedAt).toBeUndefined()
        expect(obj.executionStats).toBeUndefined()
        expect(obj.lastRun).toBeUndefined()

        const meta = obj.metadata as Record<string, unknown> | undefined
        expect(meta).toBeDefined()
        expect((meta as Record<string, unknown>).template).toBeUndefined()
        expect((meta as Record<string, unknown>).userNote).toBe("keep me")
      })
    })

    it("survives reload (persistence)", async () => {
      const freshRegistry = new TemplateRegistry()
      freshRegistry.reloadBuiltins(userDir, undefined, "user")
      const t = freshRegistry.get("saved-workflow")
      expect(t).toBeDefined()
      expect(t!.metadata.source).toBe("user")
      expect(t!.metadata.name).toBe("Saved Workflow")
    })

    it("created template can be instantiated", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/templates/saved-workflow/instantiate`,
          { params: {} },
        )
        expect(statusCode).toBe(200)
        const data = JSON.parse(body)
        expect(data.workflow).toBeDefined()
        expect(data.workflow.id).toBeTruthy()
        expect(data.workflow.steps).toHaveLength(1)
        expect(data.workflow.steps[0].type).toBe("http")
        expect(data.metadata.templateId).toBe("saved-workflow")
      })
    })
  })

  describe("POST /api/flow/templates/recommend", () => {
    it("returns monitoring recommendations for a monitoring query", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/templates/recommend`,
          { query: "monitor an endpoint every 5 minutes" },
        )
        expect(statusCode).toBe(200)
        const data = JSON.parse(body)
        expect(data.recommendations).toBeDefined()
        expect(data.recommendations.length).toBeGreaterThan(0)
        const ids = data.recommendations.map((r: { templateId: string }) => r.templateId)
        expect(ids).toContain("scheduled-health-check")
      })
    })

    it("returns webhook recommendations for a webhook query", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/templates/recommend`,
          { query: "slack webhook relay" },
        )
        expect(statusCode).toBe(200)
        const data = JSON.parse(body)
        expect(data.recommendations.length).toBeGreaterThan(0)
        const ids = data.recommendations.map((r: { templateId: string }) => r.templateId)
        expect(ids).toContain("webhook-relay")
      })
    })

    it("returns AI recommendations for an AI query", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/templates/recommend`,
          { query: "query an llm" },
        )
        expect(statusCode).toBe(200)
        const data = JSON.parse(body)
        expect(data.recommendations.length).toBeGreaterThan(0)
        const ids = data.recommendations.map((r: { templateId: string }) => r.templateId)
        expect(ids).toContain("llm-query")
      })
    })

    it("returns 400 for empty query", async () => {
      await withServer(async (port) => {
        const { statusCode, body } = await postJson(
          `http://localhost:${port}/api/flow/templates/recommend`,
          { query: "" },
        )
        expect(statusCode).toBe(400)
        const data = JSON.parse(body)
        expect(data.error).toContain("query")
      })
    })
  })
})
