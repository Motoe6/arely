import { ulid } from "ulid"
import type { Workflow, TriggerDef } from "../types.js"
import { CompilationError } from "../errors/compilation-error.js"

const VALID_TRIGGER_TYPES = new Set(["manual", "webhook", "interval", "event"])

export function normalizeWorkflow(raw: Record<string, unknown>): Workflow {
  if (!raw.id) {
    raw.id = ulid()
  }
  if (typeof raw.id !== "string") {
    throw new CompilationError("workflow id must be a string", "PARSE")
  }

  const version = raw.version ?? "1.0.0"
  if (typeof version !== "string") {
    throw new CompilationError("workflow version must be a string", "PARSE")
  }

  if (!raw.steps || !Array.isArray(raw.steps)) {
    throw new CompilationError("workflow must have a steps array", "PARSE")
  }

  const trigger = normalizeTrigger(raw.trigger)

  const steps = raw.steps.map((step: unknown, i: number) => {
    if (!step || typeof step !== "object") {
      throw new CompilationError(`step at index ${i} must be an object`, "PARSE")
    }
    const s = step as Record<string, unknown>
    if (!s.id || typeof s.id !== "string") {
      throw new CompilationError(`step at index ${i} must have a string id`, "PARSE")
    }
    if (!s.type || typeof s.type !== "string") {
      throw new CompilationError(`step "${s.id}" must have a string type`, "PARSE")
    }

    const nextRaw = s.next
    const next =
      typeof nextRaw === "string"
        ? nextRaw
        : Array.isArray(nextRaw)
          ? (nextRaw as string[]).filter((x): x is string => typeof x === "string")
          : undefined

    return {
      id: s.id,
      type: s.type,
      input: (s.input as Record<string, unknown> | undefined) ?? {},
      next: next && next.length > 0 ? (next.length === 1 ? next[0] : next) : undefined,
      onFailure: s.onFailure as
        | { retry?: { maxAttempts: number; delayMs: number }; fallback?: string }
        | undefined,
    }
  })

  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : undefined,
    description: typeof raw.description === "string" ? raw.description : undefined,
    version,
    trigger,
    steps,
  }
}

function normalizeTrigger(raw: unknown): TriggerDef | undefined {
  if (!raw) return undefined

  const t = raw as Record<string, unknown>
  if (typeof t.type !== "string") {
    throw new CompilationError("trigger must have a type field", "PARSE")
  }
  if (!VALID_TRIGGER_TYPES.has(t.type)) {
    throw new CompilationError(
      `invalid trigger type "${t.type}". Must be one of: ${Array.from(VALID_TRIGGER_TYPES).join(", ")}`,
      "PARSE"
    )
  }

  return {
    type: t.type as TriggerDef["type"],
    config: (t.config as Record<string, unknown>) ?? undefined,
  }
}
