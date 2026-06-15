import { globalNodeRegistry } from "@arely/flow-sdk"
import { validateDAG } from "@arely/flow-runtime"
import type { Workflow } from "@arely/flow-runtime"
import { AICompilerError } from "./schema.js"

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateWorkflow(workflow: Workflow, nodeRegistry?: typeof globalNodeRegistry): ValidationResult {
  const errors: string[] = []
  const registry = nodeRegistry ?? globalNodeRegistry

  for (const step of workflow.steps) {
    if (!registry.has(step.type)) {
      errors.push(`Step "${step.id}" references unknown node type: "${step.type}"`)
    }
  }

  const dagResult = validateDAG(workflow)

  if (!dagResult.valid) {
    for (const cycle of dagResult.cycles) {
      errors.push(`Cycle detected: ${cycle.join(" → ")}`)
    }
    for (const ref of dagResult.missingReferences) {
      errors.push(`Step "${ref.from}" references undefined step "${ref.ref}"`)
    }
    for (const id of dagResult.selfReferences) {
      errors.push(`Step "${id}" references itself`)
    }
  }

  return { valid: errors.length === 0, errors }
}

export function assertValidWorkflowOrThrow(workflow: Workflow, nodeRegistry?: typeof globalNodeRegistry): void {
  const result = validateWorkflow(workflow, nodeRegistry)
  if (!result.valid) {
    throw new AICompilerError(`Workflow validation failed:\n${result.errors.join("\n")}`)
  }
}
