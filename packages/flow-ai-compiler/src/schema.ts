import type { Workflow, WorkflowStep, TriggerDef } from "@arely/flow-runtime"

export interface LLMWorkflowOutput {
  workflow: Workflow
  confidence: number
  assumptions: string[]
}

export function assertValidWorkflow(raw: unknown): asserts raw is Workflow {
  if (typeof raw !== "object" || raw === null) {
    throw new AICompilerError("Workflow must be an object")
  }

  const w = raw as Record<string, unknown>

  if (typeof w.id !== "string" || w.id.length === 0) {
    throw new AICompilerError("Workflow must have a non-empty string id")
  }

  if (typeof w.version !== "string") {
    throw new AICompilerError("Workflow must have a version string")
  }

  if (w.trigger) {
    assertValidTrigger(w.trigger)
  }

  if (!Array.isArray(w.steps) || w.steps.length === 0) {
    throw new AICompilerError("Workflow must have at least one step")
  }

  for (const step of w.steps) {
    assertValidStep(step)
  }
}

function assertValidTrigger(raw: unknown): asserts raw is TriggerDef {
  const t = raw as Record<string, string>
  if (typeof t.type !== "string") {
    throw new AICompilerError("Trigger must have a type string")
  }
  const valid = ["webhook", "interval", "manual", "event"]
  if (!valid.includes(t.type)) {
    throw new AICompilerError(`Invalid trigger type: ${t.type}. Must be one of: ${valid.join(", ")}`)
  }
}

function assertValidStep(raw: unknown): asserts raw is WorkflowStep {
  if (typeof raw !== "object" || raw === null) {
    throw new AICompilerError("Each step must be an object")
  }

  const s = raw as Record<string, unknown>

  if (typeof s.id !== "string" || s.id.length === 0) {
    throw new AICompilerError("Each step must have a non-empty string id")
  }

  if (typeof s.type !== "string" || s.type.length === 0) {
    throw new AICompilerError(`Step "${s.id}" must have a non-empty type string`)
  }

  if (s.next !== undefined && typeof s.next !== "string" && !Array.isArray(s.next)) {
    throw new AICompilerError(`Step "${s.id}" next must be a string or array of strings`)
  }

  if (s.next !== undefined && Array.isArray(s.next)) {
    for (const n of s.next) {
      if (typeof n !== "string") {
        throw new AICompilerError(`Step "${s.id}" next array must contain only strings`)
      }
    }
  }

  if (s.input !== undefined && (typeof s.input !== "object" || s.input === null || Array.isArray(s.input))) {
    throw new AICompilerError(`Step "${s.id}" input must be an object`)
  }

  const allowed = ["id", "type", "input", "next", "onFailure"]
  for (const key of Object.keys(s)) {
    if (!allowed.includes(key)) {
      throw new AICompilerError(`Step "${s.id}" contains unknown field: ${key}`)
    }
  }
}

export class AICompilerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AICompilerError"
  }
}
