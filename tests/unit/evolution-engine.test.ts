import { describe, it, expect, vi, beforeEach } from "vitest"
import { TemplateRegistry } from "@arely/engine/templates/template-registry.js"
import { evolveWorkflow } from "@arely/engine/templates/evolution-engine.js"
import type { Template, NodeRegistryLike } from "@arely/engine/templates/template-types.js"
import type { CompilerLLMAdapter } from "@arely/flow-ai-compiler"
import { createWorkflow } from "@arely/engine/persistence/workflow-store.js"
import { globalNodeRegistry, HttpNode } from "@arely/flow-sdk"

vi.mock("@arely/engine/persistence/workflow-store.js", () => ({
  createWorkflow: vi.fn(() => ({
    id: "wf-evolution-test",
    name: "api-monitor",
    description: null,
    currentVersionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })),
  createWorkflowVersion: vi.fn(() => ({
    id: "wfv-evolution-test",
    workflowId: "wf-evolution-test",
    version: 1,
    workflowDsl: "{}",
    status: "active",
    createdAt: new Date().toISOString(),
  })),
}))

function makeTemplate(
  overrides: Partial<Template["metadata"]> & { id: string },
): Template {
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

describe("evolveWorkflow", () => {
  let registry: TemplateRegistry

  beforeAll(() => {
    globalNodeRegistry.register(HttpNode)
  })

  afterAll(() => {
    globalNodeRegistry.unregister("http")
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    registry = new TemplateRegistry()
    registry.registerInline(makeTemplate({
      id: "api-monitor",
      name: "API Monitor",
      description: "Monitor an API endpoint periodically and send alerts",
      category: "monitoring",
      tags: ["api", "monitor", "alert", "schedule"],
      parameters: [
        { name: "apiUrl", type: "string", label: "API URL", required: true, description: "The URL of the API to monitor" },
        { name: "intervalMinutes", type: "number", label: "Interval (min)", description: "Check interval in minutes" },
        { name: "notifyOnFailure", type: "boolean", label: "Notify on failure", description: "Send alert when API fails" },
      ],
    }))
    registry.registerInline(makeTemplate({
      id: "llm-summary",
      name: "LLM Summary",
      description: "Summarize text content using an LLM",
      category: "ai",
      tags: ["llm", "summary", "ai"],
      parameters: [
        { name: "inputText", type: "string", label: "Input text", required: true },
        { name: "maxWords", type: "number", label: "Max words", description: "Maximum summary length in words" },
      ],
    }))
  })

  it("returns empty diagnostics when no template matches", async () => {
    const result = await evolveWorkflow({
      query: "zxywvutsrqpnm",
      registry,
      adapter: mockAdapter,
      nodeRegistry: testNodeRegistry,
    })
    expect(result.success).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics[0].phase).toBe("recommendation")
    expect(result.diagnostics[0].kind).toBe("warning")
  })

  it("returns below-threshold diagnostics for weak match", async () => {
    registry.registerInline(makeTemplate({
      id: "weak-custom",
      name: "Custom Script Runner",
      description: "runs custom automation logic",
      category: "tools",
      tags: ["custom"],
    }))
    const result = await evolveWorkflow({
      query: "automation script",
      registry,
      adapter: mockAdapter,
      nodeRegistry: testNodeRegistry,
    })
    expect(result.success).toBe(false)
    const recDiag = result.diagnostics.find(d => d.phase === "recommendation" && d.kind === "warning")
    expect(recDiag).toBeDefined()
    expect(recDiag!.kind).toBe("warning")
  })

  it("instantiates template with LLM-inferred params for good match", async () => {
    mockGenerateStructured.mockResolvedValue({
      params: { apiUrl: "https://api.example.com/health", intervalMinutes: 5, notifyOnFailure: true },
      reasoning: "User wants API monitoring at 5-minute intervals",
      confidence: 0.92,
    })
    const result = await evolveWorkflow({
      query: "monitor my API at https://api.example.com/health every 5 minutes and alert me if it goes down",
      registry,
      adapter: mockAdapter,
      nodeRegistry: testNodeRegistry,
    })
    if (!result.success) {
      console.error("DIAG:", JSON.stringify(result.diagnostics, null, 2))
    }
    expect(result.success).toBe(true)
    expect(result.templateId).toBe("api-monitor")
    expect(result.workflow).toBeDefined()
    expect(result.adaptedParams).toEqual({
      apiUrl: "https://api.example.com/health",
      intervalMinutes: 5,
      notifyOnFailure: true,
    })
    const adDiag = result.diagnostics.find(d => d.phase === "adaptation")
    expect(adDiag).toBeDefined()
    expect(adDiag!.kind).toBe("info")
  })

  it("falls through to defaults when LLM param inference fails", async () => {
    registry.registerInline(makeTemplate({
      id: "llm-failure-test",
      name: "Optional Monitor",
      description: "monitoring with all optional params",
      category: "monitoring",
      tags: ["t9x7k2"],
      parameters: [
        { name: "apiUrl", type: "string", label: "API URL", description: "The URL of the API to monitor" },
        { name: "interval", type: "number", label: "Interval", description: "Check interval" },
      ],
    }))
    mockGenerateStructured.mockRejectedValue(new Error("LLM unavailable"))
    const result = await evolveWorkflow({
      query: "t9x7k2",
      registry,
      adapter: mockAdapter,
      nodeRegistry: testNodeRegistry,
    })
    if (!result.success) {
      console.error("DIAG (llm-fail):", JSON.stringify(result.diagnostics, null, 2))
    }
    expect(result.success).toBe(true)
    expect(result.templateId).toBe("llm-failure-test")
    expect(result.workflow).toBeDefined()
    const adDiag = result.diagnostics.find(d => d.phase === "adaptation")
    expect(adDiag).toBeDefined()
    expect(adDiag!.kind).toBe("warning")
  })

  it("instantiates template without parameters directly", async () => {
    registry.registerInline(makeTemplate({
      id: "no-param-template",
      name: "Simple Logger",
      description: "Logs a message",
      category: "utility",
      tags: ["log", "simple"],
    }))
    const result = await evolveWorkflow({
      query: "simple log",
      registry,
      adapter: mockAdapter,
      nodeRegistry: testNodeRegistry,
    })
    if (!result.success) {
      console.error("DIAG (no-param):", JSON.stringify(result.diagnostics, null, 2))
    }
    expect(result.success).toBe(true)
    expect(result.templateId).toBe("no-param-template")
    const adDiag = result.diagnostics.find(d => d.phase === "adaptation")
    expect(adDiag).toBeDefined()
    expect(adDiag!.kind).toBe("info")
    expect(adDiag!.message).toContain("no parameters")
  })

  it("reports all three diagnostic phases on successful evolution", async () => {
    registry.registerInline(makeTemplate({
      id: "phase-test",
      name: "Phase Tester",
      description: "test through all three phases",
      category: "testing",
      tags: ["phase-test-only"],
      parameters: [
        { name: "url", type: "string", label: "URL", description: "target URL" },
      ],
    }))
    mockGenerateStructured.mockResolvedValue({
      params: { url: "https://example.com/test" },
      reasoning: "Testing all phases",
      confidence: 0.8,
    })
    const result = await evolveWorkflow({
      query: "phase-test-only",
      registry,
      adapter: mockAdapter,
      nodeRegistry: testNodeRegistry,
    })
    expect(result.success).toBe(true)
    expect(result.templateId).toBe("phase-test")
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(3)
    const phases = result.diagnostics.map(d => d.phase)
    expect(phases).toContain("recommendation")
    expect(phases).toContain("adaptation")
    expect(phases).toContain("instantiation")
  })

  it("persists workflow via createWorkflow", async () => {
    mockGenerateStructured.mockResolvedValue({
      params: { apiUrl: "https://example.com/api" },
      reasoning: "Monitoring basic API",
      confidence: 0.7,
    })
    const result = await evolveWorkflow({
      query: "check if my api at https://example.com/api is working",
      registry,
      adapter: mockAdapter,
      nodeRegistry: testNodeRegistry,
    })
    expect(result.success).toBe(true)
    expect(result.workflow!.id).toBe("wf-evolution-test")
    expect(createWorkflow).toHaveBeenCalled()
  })
})
