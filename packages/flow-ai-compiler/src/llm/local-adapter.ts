import type { z } from "zod"
import type { CompilerLLMAdapter } from "./adapter.js"

export interface LocalAdapterConfig {
  endpoint: string
  model: string
  timeoutMs: number
}

const DEFAULT_CONFIG: LocalAdapterConfig = {
  endpoint: "http://localhost:11434/v1",
  model: "llama3.1",
  timeoutMs: 30_000,
}

export function createLocalAdapter(partial?: Partial<LocalAdapterConfig>): CompilerLLMAdapter {
  const config = { ...DEFAULT_CONFIG, ...partial }

  async function generateStructured<T>(system: string, prompt: string, schema: z.ZodType<T>): Promise<T> {
    const body = {
      model: config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      stream: false,
    }

    const res = await fetch(`${config.endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown")
      throw new Error(`Ollama API error (${res.status}): ${text}`)
    }

    const json = await res.json() as { choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content
    if (!content) {
      throw new Error("Ollama returned empty response")
    }

    const parsed = JSON.parse(content) as Record<string, unknown>
    return schema.parse(parsed) as T
  }

  async function health(): Promise<{ ok: boolean; model: string }> {
    try {
      const res = await fetch(`${config.endpoint}/models`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) return { ok: false, model: config.model }
      return { ok: true, model: config.model }
    } catch {
      return { ok: false, model: config.model }
    }
  }

  return { generateStructured, health }
}
