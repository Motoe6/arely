import { z } from "zod"

export const CompilerConfigSchema = z.object({
  provider: z.enum(["local", "remote"]).default("local"),
  localEndpoint: z.string().default("http://localhost:11434/v1"),
  localModel: z.string().default("llama3.1"),
  remoteEndpoint: z.string().optional(),
  remoteApiKey: z.string().optional(),
  remoteModel: z.string().optional(),
  remoteProvider: z.enum(["openai", "deepseek", "openrouter", "generic"]).default("generic"),
  timeoutMs: z.number().default(30_000),
})

export type CompilerConfig = z.infer<typeof CompilerConfigSchema>

export function loadCompilerConfig(overrides?: Partial<CompilerConfig>): CompilerConfig {
  const fromEnv: Record<string, string | undefined> = {
    provider: process.env["COMPILER_LLM_PROVIDER"],
    localEndpoint: process.env["COMPILER_LLM_ENDPOINT"],
    localModel: process.env["COMPILER_LLM_MODEL"],
    remoteEndpoint: process.env["OPENAI_BASE_URL"] ?? process.env["COMPILER_LLM_ENDPOINT"],
    remoteApiKey: process.env["COMPILER_LLM_API_KEY"] ?? process.env["OPENAI_API_KEY"],
    remoteModel: process.env["COMPILER_LLM_MODEL"],
    remoteProvider: process.env["COMPILER_LLM_PROVIDER"] ?? process.env["LLM_PROVIDER"],
  }

  const raw: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(fromEnv)) {
    if (val !== undefined) raw[key] = val
  }
  if (process.env["COMPILER_LLM_TIMEOUT_MS"]) {
    raw.timeoutMs = Number(process.env["COMPILER_LLM_TIMEOUT_MS"])
  }

  return CompilerConfigSchema.parse({ ...raw, ...overrides }) as CompilerConfig
}
