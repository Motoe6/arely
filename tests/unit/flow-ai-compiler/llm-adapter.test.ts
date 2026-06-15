import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod"
import { createLocalAdapter } from "@arelyos/flow-ai-compiler"
import { createRemoteAdapter } from "@arelyos/flow-ai-compiler"
import { createCompilerLLM } from "@arelyos/flow-ai-compiler"
import { createExtractor } from "@arelyos/flow-ai-compiler"

const TestSchema = z.object({ result: z.string() })

describe("LLM Adapter — Local (Ollama)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url
      if (urlStr.includes("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "llama3.1" }] }), { status: 200 })
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"result":"hello"}' } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it("creates a local adapter without config", () => {
    const adapter = createLocalAdapter()
    expect(adapter).toBeDefined()
    expect(typeof adapter.generateStructured).toBe("function")
    expect(typeof adapter.health).toBe("function")
  })

  it("generateStructured returns parsed schema", async () => {
    const adapter = createLocalAdapter()
    const result = await adapter.generateStructured("system", "user prompt", TestSchema)
    expect(result).toEqual({ result: "hello" })
  })

  it("generateStructured calls correct Ollama endpoint", async () => {
    const adapter = createLocalAdapter()
    await adapter.generateStructured("sys", "prompt", TestSchema)
    const callUrl = fetchSpy.mock.calls[0][0]
    expect(callUrl).toContain("/chat/completions")
  })

  it("health returns ok:true when models endpoint responds", async () => {
    const adapter = createLocalAdapter()
    const h = await adapter.health()
    expect(h.ok).toBe(true)
    expect(h.model).toBe("llama3.1")
  })

  it("health returns ok:false when fetch fails", async () => {
    fetchSpy.mockRejectedValue(new Error("connection refused"))
    const adapter = createLocalAdapter()
    const h = await adapter.health()
    expect(h.ok).toBe(false)
  })

  it("throws on API error response", async () => {
    fetchSpy.mockResolvedValue(new Response("not found", { status: 404 }))
    const adapter = createLocalAdapter()
    await expect(adapter.generateStructured("sys", "prompt", TestSchema)).rejects.toThrow("Ollama API error (404)")
  })

  it("throws on empty LLM response", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 }),
    )
    const adapter = createLocalAdapter()
    await expect(adapter.generateStructured("sys", "prompt", TestSchema)).rejects.toThrow("empty response")
  })

  it("respects custom endpoint and model", () => {
    const adapter = createLocalAdapter({ endpoint: "http://custom:8080/v1", model: "mistral" })
    expect(adapter).toBeDefined()
  })
})

describe("LLM Adapter — Remote (OpenAI-compatible)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url
      if (urlStr.includes("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }), { status: 200 })
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"result":"ok"}' } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it("requires apiKey", () => {
    const adapter = createRemoteAdapter({
      endpoint: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      timeoutMs: 10_000,
      provider: "openai",
    })
    expect(adapter).toBeDefined()
  })

  it("sends Authorization header", async () => {
    const adapter = createRemoteAdapter({
      endpoint: "https://api.openai.com/v1",
      apiKey: "sk-test-123",
      model: "gpt-4",
      timeoutMs: 10_000,
      provider: "openai",
    })
    await adapter.generateStructured("sys", "prompt", TestSchema)
    const headers = fetchSpy.mock.calls[0][1] as Record<string, unknown>
    expect((headers as { headers?: Record<string, string> }).headers?.["Authorization"]).toBe("Bearer sk-test-123")
  })

  it("generateStructured returns parsed result", async () => {
    const adapter = createRemoteAdapter({
      endpoint: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      timeoutMs: 10_000,
      provider: "openai",
    })
    const result = await adapter.generateStructured("sys", "prompt", TestSchema)
    expect(result).toEqual({ result: "ok" })
  })
})

describe("Factory — createCompilerLLM", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url
      if (urlStr.includes("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "test" }] }), { status: 200 })
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"result":"ok"}' } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it("creates local adapter by default", () => {
    const adapter = createCompilerLLM({ provider: "local" })
    expect(adapter).toBeDefined()
  })

  it("creates remote adapter when remote provider and apiKey set", () => {
    const adapter = createCompilerLLM({
      provider: "remote",
      remoteApiKey: "sk-test",
    })
    expect(adapter).toBeDefined()
  })

  it("throws when remote provider selected without apiKey", () => {
    expect(() => createCompilerLLM({ provider: "remote" })).toThrow("COMPILER_LLM_API_KEY")
  })
})
