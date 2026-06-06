import { parse as parseYAML } from "yaml"
import type { Workflow } from "../types.js"
import { normalizeWorkflow } from "./normalize.js"
import { CompilationError } from "../errors/compilation-error.js"

export type InputFormat = "json" | "yaml"

export function parseWorkflow(input: string, format: InputFormat): Workflow {
  let parsed: Record<string, unknown>

  try {
    if (format === "yaml") {
      parsed = parseYAML(input) as Record<string, unknown>
    } else {
      parsed = JSON.parse(input) as Record<string, unknown>
    }
  } catch (err) {
    throw new CompilationError(
      `Failed to parse ${format.toUpperCase()} input: ${(err as Error).message}`,
      "PARSE"
    )
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CompilationError("Input must be a JSON/YAML object", "PARSE")
  }

  return normalizeWorkflow(parsed)
}
