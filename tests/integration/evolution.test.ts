import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { initTestDb, cleanupTestDb } from "../setup.js"
import { TemplateRegistry } from "@arelyos/engine/templates/template-registry.js"
import { evolveWorkflow } from "@arelyos/engine/templates/evolution-engine.js"
import { getWorkflowWithCurrentVersion } from "@arelyos/engine/persistence/workflow-store.js"
import type { Template, NodeRegistryLike } from "@arelyos/engine/templates/template-types.js"
import type { CompilerLLMAdapter } from "@arelyos/flow-ai-compiler"
import { globalNodeRegistry, HttpNode } from "@arelyos/flow-sdk"

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
    workflowDsl: "",
    workflowObj: {
      name: overrides.id,
      description: "test",
      trigger: { type: "manual" },
      steps: [
        { id: "step1", type: "http", input: { url: "https://example.com" } },
      ],
    },
  }
}

const mockGenerateStructured = vi.fn()
const mockAdapter: CompilerLLMAdapter = {
  generateStructured: mockGenerateStructured as CompilerLLMAdapter["generateStructured"],
  health: vi.fn().mockResolvedValue({ ok: true, model: "test" }),
}

const testNodeRegistry: NodeRegistryLike = {
  has: (type: string) => type === "http",
  list: () => [{ type: "http" }],
}

describe("Workflow Evolution Integration", () => {
  let registry: TemplateRegistry

  beforeAll(() => {
    globalNodeRegistry.register(HttpNode)
  })

  afterAll(() => {
    globalNodeRegistry.unregister("http")
  })

  beforeEach(() => {
    initTestDb()
    vi.restoreAllMocks()
    registry = new TemplateRegistry()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it("persists evolved workflow to the DB", async () => {
    registry.registerInline(makeTemplate({
      id: "api-monitor",
      name: "API Monitor",
      description: "Monitor an API endpoint periodically and send alerts",
      category: "monitoring",
      tags: ["api", "monitor", "alert", "schedule"],
      parameters: [
        { name: "apiUrl", type: "string", label: "API URL", required: true },
        { name: "intervalMinutes", type: "number", label: "Interval (min)" },
      ],
    }))

    mockGenerateStructured.mockResolvedValue({
      params: { apiUrl: "https://api.example.com/health", intervalMinutes: 5 },
      reasoning: "User wants 5-minute API monitoring",
      confidence: 0.9,
    })

    const result = await evolveWorkflow({
      query: "monitor https://api.example.com/health every 5 min",
      registry,
      adapter: mockAdapter,
      nodeRegistry: testNodeRegistry,
    })

    expect(result.success).toBe(true)
    expect(result.workflow).toBeDefined()

    const persisted = getWorkflowWithCurrentVersion(result.workflow!.id!)
    expect(persisted).toBeDefined()
    expect(persisted!.workflow.id).toBe(result.workflow!.id)
    expect(persisted!.version).not.toBeNull()
  })

  it("selects best matching template from multiple candidates", async () => {
    registry.registerInline(makeTemplate({
      id: "webhook-alert",
      name: "Webhook Alert",
      description: "Send alerts via webhook",
      category: "notifications",
      tags: ["webhook", "alert", "notification"],
    }))
    registry.registerInline(makeTemplate({
      id: "api-monitor",
      name: "API Monitor",
      description: "Monitor an API endpoint periodically",
      category: "monitoring",
      tags: ["api", "monitor", "schedule"],
      parameters: [
        { name: "apiUrl", type: "string", label: "API URL", required: true },
      ],
    }))

    mockGenerateStructured.mockResolvedValue({
      params: { apiUrl: "https://example.com/api" },
      reasoning: "API monitoring request",
      confidence: 0.85,
    })

    const result = await evolveWorkflow({
      query: "watch my api at https://example.com/api",
      registry,
      adapter: mockAdapter,
      nodeRegistry: testNodeRegistry,
    })

    expect(result.success).toBe(true)
    expect(result.templateId).toBe("api-monitor")
  })

  it("evolves template with no parameters and persists correctly", async () => {
    registry.registerInline(makeTemplate({
      id: "simple-logger",
      name: "Simple Logger",
      description: "Logs a message to the console",
      category: "utility",
      tags: ["log", "simple"],
    }))

    const result = await evolveWorkflow({
      query: "i want a simple log utility",
      registry,
      adapter: mockAdapter,
      nodeRegistry: testNodeRegistry,
    })

    expect(result.success).toBe(true)
    expect(result.templateId).toBe("simple-logger")

    const persisted = getWorkflowWithCurrentVersion(result.workflow!.id!)
    expect(persisted).toBeDefined()
    expect(persisted!.version!.status).toBe("active")
  })
})
