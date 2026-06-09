import type { CompilerLLMAdapter } from "../llm/adapter.js"
import { INTENT_SYSTEM_PROMPT, buildIntentPrompt } from "../llm/prompt-to-intent.js"
import { WorkflowIntentSchema } from "./intent-schema.js"
import { validateIntent, enforceConstraints } from "./intent-validator.js"
import type { WorkflowIntent } from "./intent-schema.js"

export class IntentExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "IntentExtractionError"
  }
}

function normalizePrompt(raw: string): string {
  return raw
    .replace(/\b(haz|crea|genera|quiero que|necesito que)\b/gi, "")
    .replace(/\b(write|create|generate|i want|i need|make a)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function createExtractor(adapter: CompilerLLMAdapter) {
  return {
    async extractIntent(raw: string): Promise<WorkflowIntent> {
      const normalized = normalizePrompt(raw)

      const intent = await adapter.generateStructured(
        INTENT_SYSTEM_PROMPT,
        buildIntentPrompt(normalized),
        WorkflowIntentSchema,
      )

      validateIntent(intent)

      return enforceConstraints(intent)
    },
  }
}
