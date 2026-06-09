import type { WorkflowStep, CompiledStep } from "../types.js"
import type { ExecutionContext } from "../template/types.js"
import { CompilationError } from "../errors/compilation-error.js"
import { resolveTemplate } from "../template/resolver.js"

export function mapStep(
  step: WorkflowStep,
  index: number,
  allSteps: WorkflowStep[],
  context: ExecutionContext
): CompiledStep {
  const stepOrder = index

  const dependsOn = computeDependsOn(step, index, allSteps)

  const resolvedInput = resolveStepInput(step.input ?? {}, context)

  return {
    id: step.id,
    toolName: step.type,
    inputMapping: JSON.stringify(resolvedInput),
    dependsOn,
    stepOrder,
    retries: step.onFailure?.retry?.maxAttempts ?? null,
    retryDelayMs: step.onFailure?.retry?.delayMs ?? null,
    timeoutMs: null,
  }
}

function computeDependsOn(
  step: WorkflowStep,
  index: number,
  allSteps: WorkflowStep[]
): string[] {
  // Sequential: the previous step must complete before this step runs
  if (index > 0) {
    return [allSteps[index - 1].id]
  }
  return []
}

function resolveStepInput(
  input: Record<string, unknown>,
  context: ExecutionContext
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      const converted = convertStepReferences(value)
      const resolvedVal = resolveTemplate(converted, context).resolved
      resolved[key] = resolvedVal
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      resolved[key] = resolveStepInput(value as Record<string, unknown>, context)
    } else {
      resolved[key] = value
    }
  }
  return resolved
}

const STEP_REF_REGEX = /\{\{\s*steps\.([a-zA-Z0-9_-]+)(?:\.[a-zA-Z0-9_-]+)*\s*\}\}/g

function convertStepReferences(input: string): string {
  return input.replace(STEP_REF_REGEX, "{{$1}}")
}
