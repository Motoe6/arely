import type { Workflow } from "@arelyos/flow-runtime"
import { globalNodeRegistry } from "@arelyos/flow-sdk"
import { buildPrompt } from "./prompt-builder.js"
import { assertValidWorkflow } from "./schema.js"
import { assertValidWorkflowOrThrow, validateWorkflow } from "./validator.js"
import { AICompilerError } from "./schema.js"
import type { LLMWorkflowOutput } from "./schema.js"

export interface LLMAdapter {
  generateStructured(prompt: string): Promise<unknown>
}

export interface CompilePromptOptions {
  nodeRegistry?: typeof globalNodeRegistry
  llm?: LLMAdapter
}

export async function compilePrompt(
  userPrompt: string,
  options?: CompilePromptOptions,
): Promise<LLMWorkflowOutput> {
  const prompt = buildPrompt(userPrompt, {
    nodeRegistry: options?.nodeRegistry,
  })

  let raw: unknown
  if (options?.llm) {
    raw = await options.llm.generateStructured(prompt)
  } else {
    raw = tryParseJSON(prompt)
  }

  return processLLMOutput(raw)
}

export async function processLLMOutput(raw: unknown): Promise<LLMWorkflowOutput> {
  if (typeof raw !== "object" || raw === null) {
    throw new AICompilerError("LLM output must be a JSON object")
  }

  const output = raw as Record<string, unknown>

  if (!output.workflow) {
    const plausible = guessWorkflowFromRaw(raw)
    if (plausible) {
      return processLLMOutput({ workflow: plausible, confidence: 0.5, assumptions: ["Inferred from non-standard output"] })
    }
    throw new AICompilerError("LLM output must contain a 'workflow' field")
  }

  assertValidWorkflow(output.workflow)

  const validation = validateWorkflow(output.workflow as Workflow)
  if (!validation.valid) {
    throw new AICompilerError(`Workflow validation failed:\n${validation.errors.join("\n")}`)
  }

  return {
    workflow: output.workflow as Workflow,
    confidence: typeof output.confidence === "number" ? output.confidence : 1,
    assumptions: Array.isArray(output.assumptions) ? output.assumptions.filter((a): a is string => typeof a === "string") : [],
  }
}

function guessWorkflowFromRaw(raw: unknown): Workflow | null {
  if (typeof raw !== "object" || raw === null) return null
  const r = raw as Record<string, unknown>

  if (typeof r.id === "string" && r.version && Array.isArray(r.steps)) {
    return {
      id: r.id as string,
      version: r.version as string,
      trigger: (r.trigger as Workflow["trigger"]) ?? { type: "manual" },
      steps: r.steps as Workflow["steps"],
    }
  }

  if (Array.isArray(r.steps)) {
    return {
      id: "ai-generated",
      version: "1.0.0",
      trigger: { type: "manual" },
      steps: r.steps as Workflow["steps"],
    }
  }

  return null
}

function tryParseJSON(text: string): unknown {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new AICompilerError("No JSON object found in prompt output")
  try {
    return JSON.parse(jsonMatch[0])
  } catch {
    throw new AICompilerError("Failed to parse LLM output as JSON")
  }
}

export { buildPrompt }
