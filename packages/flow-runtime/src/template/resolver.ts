import { TemplateResolutionError, type TemplateErrorReason } from "./errors.js"
import type { TemplateExpression, TemplateSource, ResolvedTemplate, ExecutionContext } from "./types.js"

const TEMPLATE_REGEX = /\\\{\{([^}]+)\}\}|\{\{([^}]+)\}\}/g

export function extractPlaceholders(template: string): TemplateExpression[] {
  const expressions: TemplateExpression[] = []
  let match: RegExpExecArray | null
  TEMPLATE_REGEX.lastIndex = 0

  while ((match = TEMPLATE_REGEX.exec(template)) !== null) {
    const raw = match[1] ?? match[2]
    if (!raw) continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (match[1] !== undefined) continue

    const parsed = parseExpression(trimmed)
    if (parsed) {
      expressions.push(parsed)
    }
  }

  return expressions
}

export function resolveTemplate(
  template: string,
  context: ExecutionContext
): ResolvedTemplate {
  const expressions: TemplateExpression[] = []
  TEMPLATE_REGEX.lastIndex = 0

  const resolved = template.replace(TEMPLATE_REGEX, (_match, escaped, active) => {
    if (escaped !== undefined) {
      return `{{${escaped}}}`
    }

    const raw = active.trim()
    if (!raw) return ""

    const expr = parseExpression(raw)
    if (!expr) {
      throw new TemplateResolutionError(
        `Invalid source in "${raw}": must be "trigger", "steps", or "secrets"`,
        raw,
        "INVALID_SOURCE"
      )
    }

    expressions.push(expr)

    try {
      const value = lookupInContext(context, expr.source, expr.path)
      return serializeValue(value, expr)
    } catch (err) {
      if (err instanceof TemplateResolutionError) throw err
      throw new TemplateResolutionError(
        `Unexpected error resolving "${raw}": ${String(err)}`,
        raw,
        "INVALID_EXPRESSION"
      )
    }
  })

  return { raw: template, resolved, expressions }
}

function parseExpression(raw: string): TemplateExpression | null {
  const dotIndex = raw.indexOf(".")
  const sourceStr = dotIndex === -1 ? raw : raw.slice(0, dotIndex)
  const pathStr = dotIndex === -1 ? "" : raw.slice(dotIndex + 1)

  const source = validateSource(sourceStr)
  if (!source) return null

  const path = pathStr ? pathStr.split(".").filter(Boolean) : []

  return { raw, source, path }
}

function validateSource(s: string): TemplateSource | null {
  if (s === "trigger" || s === "steps" || s === "secrets") {
    return s
  }
  return null
}

function lookupInContext(
  context: ExecutionContext,
  source: TemplateSource,
  path: string[]
): unknown {
  switch (source) {
    case "trigger":
      return walkPath(context.trigger, path)
    case "steps": {
      if (path.length === 0) {
        throw new TemplateResolutionError(
          "steps requires a step id",
          `steps`,
          "INVALID_EXPRESSION"
        )
      }
      const stepId = path[0]
      const stepOutput = context.steps.get(stepId)
      if (stepOutput === undefined) {
        throw new TemplateResolutionError(
          `Step "${stepId}" not found in execution context`,
          `steps.${stepId}`,
          "STEP_NOT_RESOLVED"
        )
      }
      return walkPath(stepOutput, path.slice(1))
    }
    case "secrets": {
      if (path.length === 0) {
        throw new TemplateResolutionError(
          "secrets requires a key name",
          `secrets`,
          "INVALID_EXPRESSION"
        )
      }
      const value = context.secrets.get(path[0])
      if (value === undefined) {
        throw new TemplateResolutionError(
          `Secret "${path[0]}" not found`,
          `secrets.${path[0]}`,
          "SECRET_NOT_FOUND"
        )
      }
      return value
    }
  }
}

function walkPath(obj: unknown, path: string[]): unknown {
  let current = obj
  for (const key of path) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== "object") {
      return undefined
    }
    if (current instanceof Map) {
      current = current.get(key)
    } else {
      current = (current as Record<string, unknown>)[key]
    }
  }
  return current
}

function serializeValue(value: unknown, expr: TemplateExpression): string {
  if (value === null || value === undefined) {
    throw new TemplateResolutionError(
      `Path "${expr.raw}" resolved to ${String(value)}`,
      expr.raw,
      value === null ? "NULL_REFERENCE" : "PATH_NOT_FOUND"
    )
  }
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}
