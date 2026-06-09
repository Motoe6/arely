import type { z } from "zod"
import type { CompilerLLMAdapter } from "./adapter.js"

export interface RemoteAdapterConfig {
  endpoint: string
  apiKey: string
  model: string
  timeoutMs: number
  provider: "openai" | "deepseek" | "openrouter" | "generic"
}

const DEFAULTS: Record<RemoteAdapterConfig["provider"], { endpoint: string; model: string }> = {
  openai: { endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  deepseek: { endpoint: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  openrouter: { endpoint: "https://openrouter.ai/api/v1", model: "anthropic/claude-3-haiku" },
  generic: { endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini" },
}

export function createRemoteAdapter(config: RemoteAdapterConfig): CompilerLLMAdapter {
  const defaults = DEFAULTS[config.provider]
  const endpoint = config.endpoint || defaults.endpoint
  const model = config.model || defaults.model

  async function generateStructured<T>(system: string, prompt: string, schema: z.ZodType<T>): Promise<T> {
    const body = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      stream: false,
    }

    const res = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown")
      throw new Error(`Remote LLM API error (${res.status}): ${text}`)
    }

    const json = await res.json() as { choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content
    if (!content) {
      throw new Error("Remote LLM returned empty response")
    }

    const parsed = JSON.parse(content) as Record<string, unknown>
    return schema.parse(parsed) as T
  }

  async function health(): Promise<{ ok: boolean; model: string }> {
    try {
      const res = await fetch(`${endpoint}/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) return { ok: false, model }
      return { ok: true, model }
    } catch {
      return { ok: false, model }
    }
  }

  return { generateStructured, health }
}
