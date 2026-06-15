import { ulid } from "ulid"
import type { TemplateRegistryLike, Template, TemplateParameter } from "./types.js"
import { getProposal, updateProposalStatus } from "@arely/persistence"
import { createTemplateVersion } from "@arely/persistence"
import { createAuditRecord } from "@arely/persistence"
import type { ProposalRecord } from "@arely/persistence"

type DbClient = any

export interface StructuralApplyResult {
  templateId: string
  oldVersion: string
  newVersion: string
  proposalId: string
  kind: string
  changes: string[]
}

export class StructuralEvolutionError extends Error {
  readonly code = "STRUCTURAL_EVOLUTION_ERROR"
  constructor(message: string) {
    super(message)
    this.name = "StructuralEvolutionError"
  }
}

const STRUCTURAL_KINDS = ["add_retry", "add_error_handling", "split_into_chain", "parameterize_value"]

export class StructuralEvolutionService {
  constructor(
    private registry: TemplateRegistryLike,
    private options?: { db?: DbClient },
  ) {}

  applyProposal(proposalId: string): StructuralApplyResult {
    const db = this.options?.db

    const proposal = getProposal(proposalId, db)
    if (!proposal) {
      throw new StructuralEvolutionError(`Proposal not found: ${proposalId}`)
    }
    if (proposal.status !== "approved") {
      throw new StructuralEvolutionError(
        `Cannot apply proposal "${proposalId}": status is "${proposal.status}", expected "approved"`,
      )
    }
    if (proposal.type !== "structural") {
      throw new StructuralEvolutionError(
        `Cannot apply proposal "${proposalId}": type "${proposal.type}" is not supported for structural evolution`,
      )
    }

    const kind = proposal.parameter
    if (!STRUCTURAL_KINDS.includes(kind)) {
      throw new StructuralEvolutionError(
        `Unknown structural evolution kind: "${kind}"`,
      )
    }

    const template = this.registry.get(proposal.templateId)
    if (!template) {
      throw new StructuralEvolutionError(`Template not found in registry: ${proposal.templateId}`)
    }

    const oldVersion = template.metadata.templateVersion
    const newVersion = bumpVersion(oldVersion)
    const workflowObj = JSON.parse(JSON.stringify(template.workflowObj)) as Record<string, unknown>
    const oldMetadata = JSON.parse(JSON.stringify(template.metadata))
    const metadata = template.metadata

    let changes: string[] = []

    switch (kind) {
      case "add_retry":
        changes = this.applyAddRetry(workflowObj)
        break
      case "add_error_handling":
        changes = this.applyAddErrorHandling(workflowObj)
        break
      case "split_into_chain":
        changes = this.applySplitIntoChain(workflowObj)
        break
      case "parameterize_value":
        changes = this.applyParameterizeValue(metadata, workflowObj)
        break
    }

    metadata.templateVersion = newVersion

    this.registry.unregisterTemplate(proposal.templateId)
    this.registry.registerInline({
      metadata,
      workflowDsl: template.workflowDsl,
      workflowObj,
    })

    updateProposalStatus(proposalId, "applied", db)

    createTemplateVersion({
      templateId: proposal.templateId,
      version: newVersion,
      workflowYaml: template.workflowDsl,
      parameters: metadata.parameters,
      source: "evolution",
      proposalId: proposal.id,
    }, db)

    const evidence = proposal.evidence

    createAuditRecord({
      templateId: proposal.templateId,
      templateVersion: newVersion,
      proposalId: proposal.id,
      proposalTitle: `${kind}: ${proposal.suggestedValue ?? ""}`,
      parameter: kind,
      oldValue: JSON.stringify({ steps: (oldMetadata as any).parameters ?? [], templateVersion: oldVersion }),
      newValue: JSON.stringify({ steps: metadata.parameters, templateVersion: newVersion, changes }),
      approvedBy: null,
      evidenceSnapshot: {
        executions: evidence.executions ?? 0,
        successRate: evidence.successRate ?? 0,
        confidence: proposal.confidence,
        score: proposal.confidence,
      },
    }, db)

    return {
      templateId: proposal.templateId,
      oldVersion,
      newVersion,
      proposalId: proposal.id,
      kind,
      changes,
    }
  }

  private applyAddRetry(workflowObj: Record<string, unknown>): string[] {
    const steps = (workflowObj.steps as Array<Record<string, unknown>>) ?? []
    const changes: string[] = []
    for (const step of steps) {
      const onFailure = step.onFailure as Record<string, unknown> | undefined
      if (!onFailure?.retry) {
        step.onFailure = { ...(onFailure || {}), retry: { maxAttempts: 3, delayMs: 1000 } }
        changes.push(`Added retry config to step "${step.id}"`)
      }
    }
    return changes
  }

  private applyAddErrorHandling(workflowObj: Record<string, unknown>): string[] {
    const steps = (workflowObj.steps as Array<Record<string, unknown>>) ?? []
    const changes: string[] = []
    const ehStepId = "error_handler"
    const hasEhStep = steps.some((s) => s.id === ehStepId)
    if (!hasEhStep) {
      steps.push({ id: ehStepId, type: "log", input: { message: "Error occurred — check logs" } })
      changes.push(`Added error handler step "${ehStepId}"`)
    }
    if (steps.length > 0) {
      const first = steps[0]
      const onFailure = first.onFailure as Record<string, unknown> | undefined
      if (!onFailure?.fallback) {
        first.onFailure = { ...(onFailure || {}), fallback: ehStepId }
        changes.push(`Added error handling fallback to step "${first.id}"`)
      }
    }
    return changes
  }

  private applySplitIntoChain(workflowObj: Record<string, unknown>): string[] {
    const steps = (workflowObj.steps as Array<Record<string, unknown>>) ?? []
    const changes: string[] = []
    if (steps.length === 1) {
      const original = steps[0]
      const splitId = `${original.id as string}_process`
      steps.push({
        id: splitId,
        type: "transform",
        input: { data: `{{steps.${original.id as string}.result}}` },
      })
      original.next = splitId
      changes.push(`Split step "${original.id}" into chain: "${original.id}" → "${splitId}"`)
    }
    return changes
  }

  private applyParameterizeValue(
    metadata: Template["metadata"],
    workflowObj: Record<string, unknown>,
  ): string[] {
    const changes: string[] = []
    const steps = (workflowObj.steps as Array<Record<string, unknown>>) ?? []
    if (metadata.parameters.length > 0) return changes
    const paramName = "target_input"
    metadata.parameters.push({
      name: paramName,
      label: "Target Input",
      type: "string",
      description: "Primary input for this workflow step",
    })
    changes.push(`Added parameter "${paramName}" to template metadata`)
    if (steps.length > 0) {
      const first = steps[0]
      const input = (first.input as Record<string, unknown>) || {}
      input[paramName] = `{{param:${paramName}}}`
      first.input = input
      changes.push(`Parameterized step "${first.id}" input with "${paramName}"`)
    }
    return changes
  }
}

function bumpVersion(current: string): string {
  const parts = current.split(".")
  const major = parseInt(parts[0] ?? "1", 10)
  const minor = parseInt(parts[1] ?? "0", 10)
  const patch = parseInt(parts[2] ?? "0", 10)
  return `${major}.${minor + 1}.${patch}`
}
