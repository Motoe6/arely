import { ulid } from "ulid"
import { getWorkflowWithCurrentVersion, parseWorkflowDsl } from "../persistence/workflow-store.js"
import { getRunWithSteps, createRun, createStepRun, completeStepRun, completeRun, getRunSteps } from "../persistence/run-store.js"
import type { RunWithSteps } from "../persistence/run-store.js"
import { getDb } from "../persistence/database.js"
import { globalNodeRegistry } from "@opencode/flow-sdk"
import type { ExecuteWorkflowResult } from "./builder-service.js"

type DbClient = any

function resolveDb(db?: DbClient): DbClient {
  return db ?? getDb()
}

function resolveInput(input: Record<string, unknown>, stepOutputs: Record<string, unknown>, triggerInput: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      resolved[key] = value
        .replace(/\{\{\s*trigger\.payload\.([^}]+)\s*\}\}/g, (_m: string, p: string) => String(triggerInput[p] ?? ""))
        .replace(/\{\{\s*steps\.([a-zA-Z0-9_-]+)(?:\.[a-zA-Z0-9_-]+)*\s*\}\}/g, (_m: string, p: string) => {
          const v = stepOutputs[p]
          return v !== undefined ? String(v) : ""
        })
    } else {
      resolved[key] = value
    }
  }
  return resolved
}

export async function replayRun(
  originalRunId: string,
  options?: { triggerInput?: Record<string, unknown> },
  db?: DbClient,
): Promise<ExecuteWorkflowResult> {
  const d = resolveDb(db)
  const original = getRunWithSteps(originalRunId, d)
  if (!original) {
    return { success: false, runId: "", steps: [], error: `Run "${originalRunId}" not found` }
  }

  const wfEntry = getWorkflowWithCurrentVersion(original.run.workflowId, d)
  if (!wfEntry || !wfEntry.version) {
    return { success: false, runId: "", steps: [], error: `Workflow version for run "${originalRunId}" not found` }
  }

  const workflow = parseWorkflowDsl(wfEntry.version)
  const triggerInput: Record<string, unknown> = options?.triggerInput ?? (original.run.triggerInput ? JSON.parse(original.run.triggerInput) : {})
  const stepResults: ExecuteWorkflowResult["steps"] = []
  const stepOutputs: Record<string, unknown> = {}

  const newRun = createRun(original.run.workflowId, original.run.workflowVersion, triggerInput, d, originalRunId)
  const originalSteps = getRunSteps(originalRunId, d)
  const originalStepMap = new Map(originalSteps.map((s) => [s.stepId, s]))

  for (const step of workflow.steps) {
    let node
    try {
      node = globalNodeRegistry.get(step.type)
    } catch {
      const stepRunId = createStepRun(newRun.id, step.id, step.type, undefined, d, originalStepMap.get(step.id)?.id).id
      completeStepRun(stepRunId, "failed", undefined, `Unknown node type "${step.type}"`, d)
      stepResults.push({ stepId: step.id, status: "failed", error: `Unknown node type "${step.type}"` })
      continue
    }

    const input = resolveInput(step.input ?? {}, stepOutputs, triggerInput)
    const stepRunId = createStepRun(newRun.id, step.id, step.type, input, d, originalStepMap.get(step.id)?.id).id

    try {
      const output = await node.execute(
        {
          workflowId: workflow.id,
          executionId: newRun.id,
          trigger: triggerInput,
          steps: stepOutputs,
          secrets: {},
        },
        input,
      )
      const outputStr = String(typeof output === "string" ? output : JSON.stringify(output))
      stepOutputs[step.id] = output
      completeStepRun(stepRunId, "completed", outputStr, undefined, d)
      stepResults.push({ stepId: step.id, status: "completed", output: outputStr })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      completeStepRun(stepRunId, "failed", undefined, error, d)
      stepResults.push({ stepId: step.id, status: "failed", error })
    }
  }

  const allOk = stepResults.every((s) => s.status === "completed")
  const finalStatus = allOk ? "completed" : "failed"
  completeRun(newRun.id, finalStatus, allOk ? undefined : "One or more steps failed", d)

  return { success: allOk, runId: newRun.id, steps: stepResults, outputs: stepOutputs }
}

export async function replayFromStep(
  originalRunId: string,
  fromStepId: string,
  options?: { triggerInput?: Record<string, unknown> },
  db?: DbClient,
): Promise<ExecuteWorkflowResult> {
  const d = resolveDb(db)
  const original = getRunWithSteps(originalRunId, d)
  if (!original) {
    return { success: false, runId: "", steps: [], error: `Run "${originalRunId}" not found` }
  }

  const wfEntry = getWorkflowWithCurrentVersion(original.run.workflowId, d)
  if (!wfEntry || !wfEntry.version) {
    return { success: false, runId: "", steps: [], error: `Workflow version for run "${originalRunId}" not found` }
  }

  const workflow = parseWorkflowDsl(wfEntry.version)
  const triggerInput: Record<string, unknown> = options?.triggerInput ?? (original.run.triggerInput ? JSON.parse(original.run.triggerInput) : {})
  const stepResults: ExecuteWorkflowResult["steps"] = []
  const stepOutputs: Record<string, unknown> = {}
  const originalSteps = getRunSteps(originalRunId, d)
  const originalStepMap = new Map(originalSteps.map((s) => [s.stepId, s]))

  const fromStepIndex = workflow.steps.findIndex((s) => s.id === fromStepId)
  if (fromStepIndex === -1) {
    return { success: false, runId: "", steps: [], error: `Step "${fromStepId}" not found in workflow` }
  }

  const newRun = createRun(original.run.workflowId, original.run.workflowVersion, triggerInput, d, originalRunId, fromStepId)

  for (const step of workflow.steps.slice(0, fromStepIndex)) {
    const originalStepRun = originalStepMap.get(step.id)
    if (originalStepRun) {
      stepOutputs[step.id] = tryParseJson(originalStepRun.output)
      stepResults.push({
        stepId: step.id,
        status: "completed",
        output: originalStepRun.output ?? undefined,
        error: originalStepRun.error ?? undefined,
      })
    }
  }

  for (const step of workflow.steps.slice(fromStepIndex)) {
    let node
    try {
      node = globalNodeRegistry.get(step.type)
    } catch {
      const stepRunId = createStepRun(newRun.id, step.id, step.type, undefined, d, originalStepMap.get(step.id)?.id).id
      completeStepRun(stepRunId, "failed", undefined, `Unknown node type "${step.type}"`, d)
      stepResults.push({ stepId: step.id, status: "failed", error: `Unknown node type "${step.type}"` })
      continue
    }

    const input = resolveInput(step.input ?? {}, stepOutputs, triggerInput)
    const stepRunId = createStepRun(newRun.id, step.id, step.type, input, d, originalStepMap.get(step.id)?.id).id

    try {
      const output = await node.execute(
        {
          workflowId: workflow.id,
          executionId: newRun.id,
          trigger: triggerInput,
          steps: stepOutputs,
          secrets: {},
        },
        input,
      )
      const outputStr = String(typeof output === "string" ? output : JSON.stringify(output))
      stepOutputs[step.id] = output
      completeStepRun(stepRunId, "completed", outputStr, undefined, d)
      stepResults.push({ stepId: step.id, status: "completed", output: outputStr })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      completeStepRun(stepRunId, "failed", undefined, error, d)
      stepResults.push({ stepId: step.id, status: "failed", error })
    }
  }

  const allOk = stepResults.every((s) => s.status === "completed")
  const finalStatus = allOk ? "completed" : "failed"
  completeRun(newRun.id, finalStatus, allOk ? undefined : "One or more steps failed", d)
  return { success: allOk, runId: newRun.id, steps: stepResults, outputs: stepOutputs }
}

function tryParseJson(str: string | null): unknown {
  if (!str) return undefined
  try {
    return JSON.parse(str)
  } catch {
    return str
  }
}
