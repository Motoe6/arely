import type { WorkflowIntent } from "./intent-schema.js"

export class IntentValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "IntentValidationError"
  }
}

export function validateIntent(intent: WorkflowIntent): void {
  if (intent.steps.length === 0) {
    throw new IntentValidationError("Intent must have at least one step")
  }

  if (intent.triggers.length === 0) {
    throw new IntentValidationError("Intent must have at least one trigger")
  }

  const ids = new Set<string>()
  for (const step of intent.steps) {
    if (ids.has(step.id)) {
      throw new IntentValidationError(`Duplicate step id: "${step.id}"`)
    }
    ids.add(step.id)

    if (step.dependencies) {
      for (const dep of step.dependencies) {
        if (!ids.has(dep) && intent.steps.every((s) => s.id !== dep)) {
          throw new IntentValidationError(`Step "${step.id}" depends on unknown step "${dep}"`)
        }
      }
    }
  }

  if (stepHasCycle(intent.steps)) {
    throw new IntentValidationError("Intent steps contain a dependency cycle")
  }

  if (intent.constraints.maxSteps !== undefined && intent.steps.length > intent.constraints.maxSteps) {
    throw new IntentValidationError(
      `Intent has ${intent.steps.length} steps, exceeds maxSteps of ${intent.constraints.maxSteps}`,
    )
  }
}

function stepHasCycle(steps: WorkflowIntent["steps"]): boolean {
  const adjacency = new Map<string, string[]>()
  for (const s of steps) {
    adjacency.set(s.id, s.dependencies ?? [])
  }

  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(id: string): boolean {
    if (inStack.has(id)) return true
    if (visited.has(id)) return false
    visited.add(id)
    inStack.add(id)
    for (const dep of adjacency.get(id) ?? []) {
      if (dfs(dep)) return true
    }
    inStack.delete(id)
    return false
  }

  for (const s of steps) {
    if (dfs(s.id)) return true
  }
  return false
}

export function enforceConstraints(intent: WorkflowIntent): WorkflowIntent {
  if (!intent.constraints.allowParallel) {
    for (let i = 0; i < intent.steps.length; i++) {
      const step = intent.steps[i]
      if (!step.dependencies || step.dependencies.length === 0) {
        if (i > 0) {
          step.dependencies = [intent.steps[i - 1].id]
        }
      }
    }
  }

  if (intent.triggers.length > 1) {
    intent = { ...intent, triggers: [intent.triggers[0]] }
  }

  return intent
}
