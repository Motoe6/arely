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
  if (step.next) {
    return typeof step.next === "string" ? [step.next] : step.next
  }
  if (index < allSteps.length - 1) {
    return [allSteps[index + 1].id]
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
      try {
        resolved[key] = resolveTemplate(value, context).resolved
      } catch (err) {
        if (err instanceof CompilationError) throw err
        throw new CompilationError(
          `Failed to resolve template in input["${key}"]: ${(err as Error).message}`,
          "RESOLVE",
          (err as { expression?: string }).expression
        )
      }
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      resolved[key] = resolveStepInput(value as Record<string, unknown>, context)
    } else {
      resolved[key] = value
    }
  }
  return resolved
}
