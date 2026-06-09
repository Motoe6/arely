import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { parse as parseYAML } from "yaml"
import { ulid } from "ulid"
import { normalizeWorkflow } from "@opencode/flow-runtime"
import { globalNodeRegistry } from "@opencode/flow-sdk"
import type { Workflow } from "@opencode/flow-runtime"
import type {
  Template,
  TemplateMetadata,
  TemplateParameter,
  TemplateSource,
  InstantiateParams,
  InstantiateResult,
  InstantiateOptions,
} from "./template-types.js"
import {
  TemplateNotFoundError,
  TemplateValidationError,
  MissingNodeRequirementError,
} from "./template-types.js"

export class TemplateRegistry {
  private templates = new Map<string, Template>()

  registerInline(template: Template): void {
    if (this.templates.has(template.metadata.id)) {
      throw new TemplateValidationError(`Template already registered: "${template.metadata.id}"`)
    }
    this.templates.set(template.metadata.id, template)
  }

  unregisterTemplate(id: string): boolean {
    return this.templates.delete(id)
  }

  registerTemplate(dir: string, source?: TemplateSource): void {
    const metadataPath = join(dir, "metadata.json")
    const templatePath = join(dir, "template.yaml")

    if (!existsSync(metadataPath)) {
      throw new TemplateValidationError(`metadata.json not found in ${dir}`)
    }
    if (!existsSync(templatePath)) {
      throw new TemplateValidationError(`template.yaml not found in ${dir}`)
    }

    let metadataRaw: Record<string, unknown>
    try {
      metadataRaw = JSON.parse(readFileSync(metadataPath, "utf-8"))
    } catch {
      throw new TemplateValidationError(`Invalid JSON in metadata.json at ${metadataPath}`)
    }

    const metadata = validateMetadata(metadataRaw)
    metadata.source = source ?? "builtin"

    let workflowDsl: string
    try {
      workflowDsl = readFileSync(templatePath, "utf-8")
    } catch {
      throw new TemplateValidationError(`Failed to read template.yaml at ${templatePath}`)
    }

    let workflowObj: Record<string, unknown>
    try {
      workflowObj = parseYAML(workflowDsl) as Record<string, unknown>
    } catch {
      throw new TemplateValidationError(`Invalid YAML in template.yaml at ${templatePath}`)
    }

    if (!workflowObj || typeof workflowObj !== "object" || Array.isArray(workflowObj)) {
      throw new TemplateValidationError(`template.yaml must contain a YAML object at ${templatePath}`)
    }

    const template: Template = { metadata, workflowDsl, workflowObj }
    this.registerInline(template)
  }

  reloadBuiltins(baseDir: string, onError?: (entry: string, err: Error) => void, source?: TemplateSource): number {
    if (!existsSync(baseDir)) return 0

    let count = 0
    const entries = readdirSync(baseDir)
    for (const entry of entries) {
      const fullPath = join(baseDir, entry)
      if (!statSync(fullPath).isDirectory()) continue
      try {
        this.registerTemplate(fullPath, source)
        count++
      } catch (err) {
        if (onError) {
          onError(entry, err instanceof Error ? err : new Error(String(err)))
        }
      }
    }
    return count
  }

  get(id: string): Template | undefined {
    return this.templates.get(id)
  }

  list(category?: string): TemplateMetadata[] {
    const all = Array.from(this.templates.values()).map((t) => t.metadata)
    if (category) {
      return all.filter((m) => m.category === category)
    }
    return all
  }

  search(tag?: string): TemplateMetadata[] {
    if (!tag) return this.list()
    return Array.from(this.templates.values())
      .filter((t) => t.metadata.tags.includes(tag))
      .map((t) => t.metadata)
  }

  listCategories(): string[] {
    const cats = new Set(Array.from(this.templates.values()).map((t) => t.metadata.category))
    return Array.from(cats).sort()
  }

  instantiate(
    id: string,
    params: InstantiateParams,
    options?: InstantiateOptions,
  ): InstantiateResult {
    const template = this.templates.get(id)
    if (!template) {
      throw new TemplateNotFoundError(`Template not found: "${id}"`)
    }

    validateTemplateRequirements(template.metadata, options?.registry)
    validateParams(template.metadata.parameters, params)

    const workflowRaw = deepClone(template.workflowObj)

    const resolvedParams: InstantiateParams = { ...params }
    for (const p of template.metadata.parameters) {
      if (resolvedParams[p.name] === undefined && p.default !== undefined) {
        resolvedParams[p.name] = p.default
      }
    }

    const resolved = applyParams(workflowRaw, resolvedParams) as Record<string, unknown>

    const workflowId = options?.workflowIdGenerator?.() ?? ulid()
    resolved.id = workflowId

    const workflow = normalizeWorkflow(resolved)

    workflow.metadata = {
      template: {
        id: template.metadata.id,
        version: template.metadata.templateVersion,
      },
    }

    validateStepNodes(workflow)

    return {
      workflow,
      metadata: {
        templateId: template.metadata.id,
        templateVersion: template.metadata.templateVersion,
      },
    }
  }
}

function validateMetadata(raw: Record<string, unknown>): TemplateMetadata {
  if (!raw.id || typeof raw.id !== "string") {
    throw new TemplateValidationError("metadata.json: 'id' is required and must be a string")
  }
  if (!raw.name || typeof raw.name !== "string") {
    throw new TemplateValidationError("metadata.json: 'name' is required and must be a string")
  }
  if (!raw.description || typeof raw.description !== "string") {
    throw new TemplateValidationError("metadata.json: 'description' is required and must be a string")
  }
  if (!raw.category || typeof raw.category !== "string") {
    throw new TemplateValidationError("metadata.json: 'category' is required and must be a string")
  }
  const templateVersion =
    typeof raw.templateVersion === "string" ? raw.templateVersion : "1.0.0"
  const author = typeof raw.author === "string" ? raw.author : "OpenCode"
  const tags: string[] = Array.isArray(raw.tags) ? (raw.tags as string[]).filter((t) => typeof t === "string") : []
  const requires: string[] = Array.isArray(raw.requires) ? (raw.requires as string[]).filter((r) => typeof r === "string") : []

  const parameters: TemplateParameter[] = []
  if (Array.isArray(raw.parameters)) {
    for (const p of raw.parameters as Record<string, unknown>[]) {
      if (!p.name || typeof p.name !== "string") {
        throw new TemplateValidationError("metadata.json: each parameter must have a string 'name'")
      }
      if (!p.label || typeof p.label !== "string") {
        throw new TemplateValidationError(`metadata.json: parameter "${p.name}" must have a string 'label'`)
      }
      const type = typeof p.type === "string" ? p.type : "string"
      if (!["string", "number", "boolean", "json"].includes(type)) {
        throw new TemplateValidationError(`metadata.json: parameter "${p.name}" has invalid type "${type}"`)
      }
      parameters.push({
        name: p.name,
        label: p.label,
        type: type as TemplateParameter["type"],
        required: p.required === true,
        default: p.default,
        description: typeof p.description === "string" ? p.description : undefined,
      })
    }
  }

  return { id: raw.id, name: raw.name, description: raw.description, category: raw.category, tags, templateVersion, author, parameters, requires, source: "builtin" as const }
}

function validateTemplateRequirements(
  metadata: TemplateMetadata,
  registry?: { has(type: string): boolean },
): void {
  const reg = registry ?? globalNodeRegistry
  const missing = metadata.requires.filter((type) => !reg.has(type))
  if (missing.length > 0) {
    throw new MissingNodeRequirementError(
      `Template "${metadata.id}" requires node type(s): ${missing.join(", ")}. ` +
      `Make sure the required nodes are installed before using this template.`,
    )
  }
}

const VALID_PARAM_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function validateParams(
  parameters: TemplateParameter[],
  params: InstantiateParams,
): void {
  for (const param of parameters) {
    const value = params[param.name]
    if (value === undefined) {
      if (param.required) {
        throw new TemplateValidationError(`Missing required parameter "${param.name}"`)
      }
      continue
    }
    validateParamType(param.name, value, param.type)
  }
}

function validateParamType(
  name: string,
  value: unknown,
  type: string,
): void {
  switch (type) {
    case "string":
      if (typeof value !== "string") {
        throw new TemplateValidationError(`Parameter "${name}" must be a string, got ${typeof value}`)
      }
      break
    case "number":
      if (typeof value !== "number" || isNaN(value)) {
        throw new TemplateValidationError(`Parameter "${name}" must be a number, got ${typeof value}`)
      }
      break
    case "boolean":
      if (typeof value !== "boolean") {
        throw new TemplateValidationError(`Parameter "${name}" must be a boolean, got ${typeof value}`)
      }
      break
    case "json":
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        if (typeof value !== "object") {
          throw new TemplateValidationError(`Parameter "${name}" must be a JSON object, got ${typeof value}`)
        }
      }
      break
  }
}

const PARAM_PLACEHOLDER_RE = /^\{\{\s*param:(\w+)\s*\}\}$/
const PARAM_INLINE_RE = /\{\{\s*param:(\w+)\s*\}\}/g

function applyParams(value: unknown, params: InstantiateParams): unknown {
  if (typeof value === "string") {
    const match = value.match(PARAM_PLACEHOLDER_RE)
    if (match) {
      const paramName = match[1]
      if (paramName in params) {
        return params[paramName]
      }
      return value
    }
    return value.replace(PARAM_INLINE_RE, (_, name: string) => {
      if (name in params) return String(params[name])
      return `{{param:${name}}}`
    })
  }
  if (Array.isArray(value)) {
    return value.map((v) => applyParams(v, params))
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = applyParams(v, params)
    }
    return result
  }
  return value
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function validateStepNodes(workflow: Workflow): void {
  const missing: string[] = []
  const seen = new Set<string>()
  for (const step of workflow.steps) {
    if (seen.has(step.type)) continue
    seen.add(step.type)
    if (!globalNodeRegistry.has(step.type)) {
      missing.push(step.type)
    }
  }
  if (missing.length > 0) {
    throw new MissingNodeRequirementError(
      `Workflow references unknown node type(s): ${missing.join(", ")}. ` +
      `Available nodes: ${globalNodeRegistry.list().map((n) => n.type).join(", ")}`,
    )
  }
}
