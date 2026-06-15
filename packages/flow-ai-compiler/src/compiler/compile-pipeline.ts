import type { Workflow } from "@arelyos/flow-runtime"
import type { NodeRegistry } from "@arelyos/flow-sdk"
import type { CompilerLLMAdapter } from "../llm/adapter.js"
import { createExtractor, IntentExtractionError } from "../intent/intent-extractor.js"
import { validateIntent, enforceConstraints, IntentValidationError } from "../intent/intent-validator.js"
import { selectNodes } from "../selector/node-selector.js"
import type { WorkflowIntent } from "../intent/intent-schema.js"
import { buildDag, DagBuildError } from "./dag-builder.js"

export interface CompileFromPromptOptions {
  prompt: string
  adapter: CompilerLLMAdapter
  registry: NodeRegistry
}

export async function compileFromPrompt(
  options: CompileFromPromptOptions,
): Promise<CompileResult> {
  const { prompt, adapter, registry } = options
  const diagnostics: CompileDiagnostic[] = []

  // B.1 — Extract intent via LLM
  let intent: WorkflowIntent
  try {
    const extractor = createExtractor(adapter)
    intent = await extractor.extractIntent(prompt)
  } catch (err) {
    const message = err instanceof IntentExtractionError ? err.message : String(err)
    diagnostics.push({ phase: "intent_extraction", kind: "error", message })
    return { success: false, workflow: null, diagnostics }
  }

  // B.1 — Validate intent deterministically (throws on failure)
  try {
    validateIntent(intent)
    intent = enforceConstraints(intent)
  } catch (err) {
    const message = err instanceof IntentValidationError ? err.message : String(err)
    diagnostics.push({ phase: "intent_validation", kind: "error", message })
    return { success: false, workflow: null, diagnostics }
  }

  // B.2 — Select nodes deterministically
  let resolvedSteps: ReturnType<typeof selectNodes>
  try {
    resolvedSteps = selectNodes(intent.steps, registry)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    diagnostics.push({ phase: "node_selection", kind: "error", message })
    return { success: false, workflow: null, diagnostics }
  }

  // B.3 — Build DAG
  try {
    const workflow = buildDag(intent, resolvedSteps)
    return { success: true, workflow, diagnostics }
  } catch (err) {
    const message = err instanceof DagBuildError ? err.message : String(err)
    diagnostics.push({ phase: "dag_build", kind: "error", message })
    return { success: false, workflow: null, diagnostics }
  }
}

export interface CompileResult {
  success: boolean
  workflow: Workflow | null
  diagnostics: CompileDiagnostic[]
}

export interface CompileDiagnostic {
  phase: "intent_extraction" | "intent_validation" | "node_selection" | "dag_build"
  kind: "error" | "warning"
  message: string
}

export class CompilePipelineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CompilePipelineError"
  }
}
