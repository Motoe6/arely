import type { z } from "zod"

export interface CompilerLLMAdapter {
  generateStructured<T>(system: string, prompt: string, schema: z.ZodType<T>): Promise<T>
  health(): Promise<{ ok: boolean; model: string }>
}
