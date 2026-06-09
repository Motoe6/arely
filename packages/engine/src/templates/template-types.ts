import type { Workflow } from "@opencode/flow-runtime"

export class TemplateNotFoundError extends Error {
  readonly code = "TEMPLATE_NOT_FOUND"
  constructor(message: string) {
    super(message)
    this.name = "TemplateNotFoundError"
  }
}

export class TemplateValidationError extends Error {
  readonly code = "TEMPLATE_VALIDATION_ERROR"
  constructor(message: string) {
    super(message)
    this.name = "TemplateValidationError"
  }
}

export class MissingNodeRequirementError extends Error {
  readonly code = "MISSING_NODE_REQUIREMENT"
  constructor(message: string) {
    super(message)
    this.name = "MissingNodeRequirementError"
  }
}

export type TemplateParamType = "string" | "number" | "boolean" | "json"
export type TemplateSource = "builtin" | "user" | "package"

export interface TemplateParameter {
  name: string
  label: string
  type: TemplateParamType
  required?: boolean
  default?: unknown
  description?: string
}

export interface TemplateMetadata {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  templateVersion: string
  author: string
  parameters: TemplateParameter[]
  requires: string[]
  source: TemplateSource
}

export interface Template {
  metadata: TemplateMetadata
  workflowDsl: string
  workflowObj: Record<string, unknown>
}

export interface InstantiateParams {
  [name: string]: unknown
}

export interface InstantiateResult {
  workflow: Workflow
  metadata: {
    templateId: string
    templateVersion: string
  }
}

export interface NodeRegistryLike {
  has(type: string): boolean
  list(): { type: string }[]
}

export interface InstantiateOptions {
  workflowIdGenerator?: () => string
  registry?: NodeRegistryLike
}
