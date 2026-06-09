import type { Workflow, WorkflowStep, TriggerDef } from "@opencode/flow-runtime"
import type { WorkflowIntent } from "../intent/intent-schema.js"
import type { ResolvedStep } from "../selector/types.js"

export function buildDag(
  intent: WorkflowIntent,
  resolvedSteps: ResolvedStep[],
): Workflow {
  const trigger = mapTrigger(intent)
  const steps = buildSteps(intent, resolvedSteps)

  return {
    id: generateWorkflowId(intent.goal),
    version: "1.0.0",
    description: intent.goal,
    trigger,
    steps,
  }
}

function mapTrigger(intent: WorkflowIntent): TriggerDef | undefined {
  if (intent.triggers.length === 0) return undefined

  const t = intent.triggers[0]
  const trigger: TriggerDef = { type: t.type as TriggerDef["type"] }

  if (t.type === "webhook") {
    trigger.config = { path: t.description.toLowerCase().replace(/\s+/g, "/") }
  } else if (t.type === "schedule") {
    trigger.config = { intervalMs: 3600000 }
  }

  return trigger
}

function buildSteps(intent: WorkflowIntent, resolvedSteps: ResolvedStep[]): WorkflowStep[] {
  if (resolvedSteps.length === 0) {
    throw new DagBuildError("No resolved steps to build DAG from")
  }

  const intentStepMap = new Map(intent.steps.map((s) => [s.id, s]))
  const resolvedStepMap = new Map(resolvedSteps.map((s) => [s.stepId, s]))

  for (const rs of resolvedSteps) {
    if (!intentStepMap.has(rs.stepId)) {
      throw new DagBuildError(`Resolved step "${rs.stepId}" has no matching intent step`)
    }
  }

  const forwardEdges = new Map<string, Set<string>>()
  for (const step of intent.steps) {
    if (step.dependencies) {
      for (const dep of step.dependencies) {
        if (resolvedStepMap.has(dep)) {
          if (!forwardEdges.has(dep)) forwardEdges.set(dep, new Set())
          forwardEdges.get(dep)!.add(step.id)
        }
      }
    }
  }

  const steps: WorkflowStep[] = []
  const added = new Set<string>()

  function addStep(id: string, index: number): void {
    if (added.has(id)) return
    added.add(id)

    const intentStep = intentStepMap.get(id)
    const resolvedStep = resolvedStepMap.get(id)
    if (!intentStep || !resolvedStep) return

    const nextIds = forwardEdges.get(id)
    const wfStep: WorkflowStep = {
      id,
      type: resolvedStep.nodeType,
    }

    if (nextIds && nextIds.size > 0) {
      wfStep.next = nextIds.size === 1 ? [...nextIds][0] : [...nextIds]
    }

    if (intentStep.inputHints) {
      wfStep.input = resolveInput(intentStep.inputHints)
    }

    if (index < resolvedSteps.length - 1 && !nextIds) {
      const nextId = resolvedSteps[index + 1].stepId
      if (!added.has(nextId)) {
        const nextIntentStep = intentStepMap.get(nextId)
        const hasExplicitDeps = nextIntentStep?.dependencies && nextIntentStep.dependencies.length > 0
        if (!hasExplicitDeps) {
          wfStep.next = nextId
        }
      }
    }

    steps.push(wfStep)
  }

  for (let i = 0; i < resolvedSteps.length; i++) {
    addStep(resolvedSteps[i].stepId, i)
  }

  for (const step of intent.steps) {
    if (!added.has(step.id)) {
      addStep(step.id, resolvedSteps.length)
    }
  }

  return steps
}

function resolveInput(hints: { source?: string; key?: string }): Record<string, unknown> {
  if (!hints.source) return {}

  if (hints.source === "trigger" && hints.key) {
    return { url: `{{ trigger.payload.${hints.key} }}` }
  }

  if (hints.source === "previous_step") {
    return hints.key ? { body: `{{ steps.${hints.key} }}` } : {}
  }

  return {}
}

function generateWorkflowId(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "workflow"
}

export class DagBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DagBuildError"
  }
}
