import { z } from "zod"
import type { CompilerLLMAdapter } from "@arely/flow-ai-compiler"
import type { Workflow } from "@arely/flow-runtime"
import type { TemplateRegistry } from "./template-registry.js"
import type { NodeRegistryLike } from "./template-types.js"
import { TemplateRecommender } from "./template-recommender.js"
import { createWorkflow, createWorkflowVersion } from "../persistence/workflow-store.js"

export interface EvolveDiagnostic {
  phase: "recommendation" | "adaptation" | "instantiation"
  kind: "info" | "warning" | "error"
  message: string
}

export interface EvolveOptions {
  query: string
  registry: TemplateRegistry
  adapter: CompilerLLMAdapter
  nodeRegistry?: NodeRegistryLike
}

export interface EvolveResult {
  success: boolean
  workflow?: Workflow
  templateId?: string
  templateName?: string
  adaptedParams?: Record<string, unknown>
  diagnostics: EvolveDiagnostic[]
}

const EVOLVE_RECOMMEND_THRESHOLD = 0.20
const MAX_CANDIDATES = 5

const ParamInferenceSchema = z.object({
  params: z.record(z.unknown()),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
})

function buildSystemPrompt(): string {
  return `You are a workflow parameter inference assistant. Given a workflow template and a user's request, fill in the template parameters with values that best match the user's intent.

Rules:
- Only include parameters you can reasonably infer from the request
- For "string" parameters without enough context, use a reasonable default or "auto"
- For "number" parameters, infer a sensible value or 0
- For "boolean" parameters, infer from context or default to false
- Output a JSON object with "params" (object), "reasoning" (string), and "confidence" (0-1) fields`
}

function buildUserPrompt(
  name: string,
  description: string,
  category: string,
  tags: string[],
  parameters: Array<{ name: string; type: string; label: string; description?: string; required?: boolean }>,
  query: string,
): string {
  const paramsDesc = parameters.map(
    p => `  - ${p.name} (${p.type}): ${p.description ?? p.label}${p.required ? " [required]" : ""}`,
  ).join("\n")

  return `Template:
- Name: ${name}
- Description: ${description}
- Category: ${category}
- Tags: ${tags.join(", ")}

Parameters:
${paramsDesc || "  (none)"}

User request: ${query}

Fill in the template parameters based on the user request.`
}

export async function evolveWorkflow(opts: EvolveOptions): Promise<EvolveResult> {
  const diagnostics: EvolveDiagnostic[] = []
  const recommender = new TemplateRecommender(opts.registry)
  const recommendations = recommender.recommend(opts.query, MAX_CANDIDATES)

  if (recommendations.length === 0) {
    diagnostics.push({
      phase: "recommendation",
      kind: "warning",
      message: "No matching templates found for the query.",
    })
    return { success: false, diagnostics }
  }

  const best = recommendations[0]
  diagnostics.push({
    phase: "recommendation",
    kind: "info",
    message: `Selected template "${best.templateId}" (score: ${best.score.toFixed(2)}) — ${best.reason}`,
  })

  if (best.score < EVOLVE_RECOMMEND_THRESHOLD) {
    diagnostics.push({
      phase: "recommendation",
      kind: "warning",
      message: `Best match score (${best.score.toFixed(2)}) is below threshold (${EVOLVE_RECOMMEND_THRESHOLD}).`,
    })
    return { success: false, diagnostics }
  }

  const template = opts.registry.get(best.templateId)
  if (!template) {
    diagnostics.push({
      phase: "recommendation",
      kind: "error",
      message: `Template "${best.templateId}" not found in registry.`,
    })
    return { success: false, diagnostics }
  }

  let adaptedParams: Record<string, unknown> = {}
  let adaptationConfidence = 0

  if (template.metadata.parameters.length > 0) {
    try {
      const systemPrompt = buildSystemPrompt()
      const userPrompt = buildUserPrompt(
        template.metadata.name,
        template.metadata.description,
        template.metadata.category,
        template.metadata.tags,
        template.metadata.parameters,
        opts.query,
      )
      const result = await opts.adapter.generateStructured<z.infer<typeof ParamInferenceSchema>>(
        systemPrompt,
        userPrompt,
        ParamInferenceSchema,
      )
      adaptedParams = result.params
      adaptationConfidence = result.confidence
      diagnostics.push({
        phase: "adaptation",
        kind: "info",
        message: `LLM inferred ${Object.keys(adaptedParams).length} parameter(s) (confidence: ${adaptationConfidence.toFixed(2)}): ${result.reasoning}`,
      })
    } catch (err) {
      diagnostics.push({
        phase: "adaptation",
        kind: "warning",
        message: `LLM parameter inference failed: ${err}. Falling back to defaults.`,
      })
    }
  } else {
    diagnostics.push({
      phase: "adaptation",
      kind: "info",
      message: "Template has no parameters. Instantiating directly.",
    })
  }

  try {
    const instantiateOpts = opts.nodeRegistry ? { registry: opts.nodeRegistry } : undefined
    const { workflow } = opts.registry.instantiate(best.templateId, adaptedParams, instantiateOpts)
    const wfRecord = createWorkflow({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
    })
    createWorkflowVersion(wfRecord.id, JSON.stringify(workflow), "active")
    workflow.id = wfRecord.id

    diagnostics.push({
      phase: "instantiation",
      kind: "info",
      message: `Workflow "${wfRecord.id}" created and persisted.`,
    })

    return {
      success: true,
      workflow,
      templateId: best.templateId,
      templateName: template.metadata.name,
      adaptedParams,
      diagnostics,
    }
  } catch (err) {
    diagnostics.push({
      phase: "instantiation",
      kind: "error",
      message: `Failed to instantiate template "${best.templateId}": ${err}`,
    })
    return { success: false, diagnostics }
  }
}
