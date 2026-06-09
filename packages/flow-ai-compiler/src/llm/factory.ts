import type { CompilerLLMAdapter } from "./adapter.js"
import { createLocalAdapter } from "./local-adapter.js"
import { createRemoteAdapter } from "./remote-adapter.js"
import type { RemoteAdapterConfig } from "./remote-adapter.js"

export interface CompilerLLMConfig {
  provider: "local" | "remote"
  localEndpoint?: string
  localModel?: string
  remoteEndpoint?: string
  remoteApiKey?: string
  remoteModel?: string
  remoteProvider?: RemoteAdapterConfig["provider"]
  timeoutMs?: number
}

export function createCompilerLLM(config: CompilerLLMConfig): CompilerLLMAdapter {
  if (config.provider === "local") {
    return createLocalAdapter({
      endpoint: config.localEndpoint,
      model: config.localModel,
      timeoutMs: config.timeoutMs,
    })
  }

  if (!config.remoteApiKey) {
    throw new Error(
      "Remote LLM provider selected but COMPILER_LLM_API_KEY is not set. " +
      "Start Ollama (ollama run llama3.1) or set COMPILER_LLM_API_KEY in config.",
    )
  }

  return createRemoteAdapter({
    endpoint: config.remoteEndpoint ?? "",
    apiKey: config.remoteApiKey,
    model: config.remoteModel ?? "",
    timeoutMs: config.timeoutMs ?? 30_000,
    provider: config.remoteProvider ?? "generic",
  })
}
