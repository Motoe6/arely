import type { Workflow, CompileResult, CompiledPipeline } from "../types.js"
import type { ExecutionContext } from "../template/types.js"
import { validateDAG } from "../validator/dag-validator.js"
import { CompilationError } from "../errors/compilation-error.js"
import { mapTrigger } from "./trigger-mapper.js"
import { mapStep } from "./step-mapper.js"

export function compileWorkflow(
  workflow: Workflow,
  context: ExecutionContext
): CompileResult {
  const errors: CompileResult["errors"] = []
  const warnings: CompileResult["warnings"] = []

  const dagResult = validateDAG(workflow)

  if (!dagResult.valid) {
    for (const cycle of dagResult.cycles) {
      errors.push({
        stepId: cycle[0],
        message: `Cycle detected: ${cycle.join(" → ")}`,
      })
    }
    for (const ref of dagResult.missingReferences) {
      errors.push({
        stepId: ref.from,
        message: `Step "${ref.from}" references undefined step "${ref.ref}" (${ref.kind})`,
      })
    }
    for (const id of dagResult.selfReferences) {
      errors.push({
        stepId: id,
        message: `Step "${id}" references itself`,
      })
    }
  }

  for (const id of dagResult.unreachableSteps) {
    warnings.push({
      stepId: id,
      message: `Step "${id}" is unreachable from the workflow start`,
    })
  }

  const steps = workflow.steps.map((step, i) => {
    try {
      return mapStep(step, i, workflow.steps, context)
    } catch (err) {
      if (err instanceof CompilationError) {
        errors.push({ stepId: step.id, message: err.message })
      } else {
        errors.push({ stepId: step.id, message: (err as Error).message })
      }
      return null
    }
  })

  const validSteps = steps.filter((s): s is NonNullable<typeof s> => s !== null)

  // Handle explicit next references: if step_a has next: step_b,
  // then step_b dependsOn must include step_a
  for (const step of workflow.steps) {
    if (step.next) {
      const nextIds = typeof step.next === "string" ? [step.next] : step.next
      for (const nextId of nextIds) {
        const target = validSteps.find((s) => s.id === nextId)
        if (target && !target.dependsOn.includes(step.id)) {
          target.dependsOn.push(step.id)
        }
      }
    }
  }

  const pipeline: CompiledPipeline = {
    name: workflow.id,
    steps: validSteps,
  }

  return { pipeline, errors, warnings }
}
