import { globalNodeRegistry } from "@arelyos/flow-sdk"
import { FEW_SHOT_EXAMPLES } from "./examples.js"

export interface PromptOptions {
  systemPrompt?: string
  nodeRegistry?: typeof globalNodeRegistry
  examples?: typeof FEW_SHOT_EXAMPLES
}

export function buildPrompt(userPrompt: string, options?: PromptOptions): string {
  const registry = options?.nodeRegistry ?? globalNodeRegistry
  const examples = options?.examples ?? FEW_SHOT_EXAMPLES

  const registeredNodes = registry.list()

  const parts: string[] = [
    `You are a deterministic workflow compiler. Convert user intent into a VALID Workflow DSL v1 JSON object.`,
    ``,
    `RULES:`,
    `- Output MUST be valid JSON matching the schema exactly`,
    `- No extra fields allowed beyond the schema`,
    `- No pseudocode, no explanations outside JSON`,
    `- The "id" field must be a short kebab-case identifier`,
    `- The "version" field must be a semver string (e.g. "1.0.0")`,
    `- Trigger type must be one of: webhook, interval, manual, event`,
    `- Each step must have "id" and "type" strings, and an "input" object`,
    `- The "next" field is optional; use it to specify which step(s) run after this one`,
    `- Use "onFailure.retry" for retry logic (maxAttempts, delayMs)`,
    ``,
  ]

  if (registeredNodes.length > 0) {
    parts.push(`AVAILABLE NODE TYPES:`)
    for (const node of registeredNodes) {
      parts.push(`  - "${node.type}" (${node.category}): ${node.label}`)
    }
    parts.push(``)
    parts.push(`You MUST only use the node types listed above.`)
    parts.push(``)
  }

  parts.push(`DSL SCHEMA:`)
  parts.push(`{`)
  parts.push(`  "id": "string (kebab-case)",`)
  parts.push(`  "version": "string (semver)",`)
  parts.push(`  "trigger": { "type": "webhook|interval|manual|event", "config?": {} },`)
  parts.push(`  "steps": [`)
  parts.push(`    { "id": "string", "type": "string", "input": {}, "next?": "string|string[]", "onFailure?": { "retry?": { "maxAttempts": number, "delayMs": number } } }`)
  parts.push(`  ]`)
  parts.push(`}`)
  parts.push(``)

  if (examples.length > 0) {
    parts.push(`EXAMPLES:`)
    for (const ex of examples) {
      parts.push(`Input: ${ex.input}`)
      parts.push(`Output: ${JSON.stringify(ex.output.workflow, null, 2)}`)
      parts.push(``)
    }
  }

  parts.push(`USER REQUEST:`)
  parts.push(userPrompt)
  parts.push(``)
  parts.push(`Respond with ONLY a JSON object matching the Workflow DSL schema above. No markdown, no code blocks, no explanation.`)

  return parts.join("\n")
}
