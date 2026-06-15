import type { TemplateRegistryLike, TemplateParameter } from "./types.js"
import { getProposal, updateProposalStatus } from "@arelyos/persistence"
import { createTemplateVersion } from "@arelyos/persistence"
import { createAuditRecord } from "@arelyos/persistence"
import type { ProposalRecord } from "@arelyos/persistence"

type DbClient = any

export interface ApplyProposalResult {
  templateId: string
  oldVersion: string
  newVersion: string
  proposalId: string
  parameter: string
  oldValue: unknown
  newValue: unknown
}

export class TemplateEvolutionError extends Error {
  readonly code = "TEMPLATE_EVOLUTION_ERROR"
  constructor(message: string) {
    super(message)
    this.name = "TemplateEvolutionError"
  }
}

export class TemplateEvolutionService {
  constructor(
    private registry: TemplateRegistryLike,
    private options?: { db?: DbClient },
  ) {}

  applyProposal(proposalId: string): ApplyProposalResult {
    const db = this.options?.db

    const proposal = getProposal(proposalId, db)
    if (!proposal) {
      throw new TemplateEvolutionError(`Proposal not found: ${proposalId}`)
    }
    if (proposal.status !== "approved") {
      throw new TemplateEvolutionError(
        `Cannot apply proposal "${proposalId}": status is "${proposal.status}", expected "approved"`,
      )
    }
    if (proposal.type !== "parameter_change") {
      throw new TemplateEvolutionError(
        `Cannot apply proposal "${proposalId}": type "${proposal.type}" is not supported for auto-evolution`,
      )
    }

    const template = this.registry.get(proposal.templateId)
    if (!template) {
      throw new TemplateEvolutionError(`Template not found in registry: ${proposal.templateId}`)
    }

    const paramDef = template.metadata.parameters.find((p) => p.name === proposal.parameter)
    if (!paramDef) {
      throw new TemplateEvolutionError(
        `Parameter "${proposal.parameter}" not found in template "${proposal.templateId}"`,
      )
    }

    const oldValue = paramDef.default
    const convertedValue = convertToType(proposal.suggestedValue, paramDef.type)
    const newVersion = bumpVersion(template.metadata.templateVersion)

    const updatedParams = template.metadata.parameters.map((p) => {
      if (p.name === proposal.parameter) {
        return { ...p, default: convertedValue }
      }
      return p
    })

    const updatedMetadata = {
      ...template.metadata,
      parameters: updatedParams,
      templateVersion: newVersion,
    }

    this.registry.unregisterTemplate(proposal.templateId)
    this.registry.registerInline({
      metadata: updatedMetadata,
      workflowDsl: template.workflowDsl,
      workflowObj: template.workflowObj,
    })

    updateProposalStatus(proposalId, "applied", db)

    createTemplateVersion({
      templateId: proposal.templateId,
      version: newVersion,
      workflowYaml: template.workflowDsl,
      parameters: updatedParams,
      source: "evolution",
      proposalId: proposal.id,
    }, db)

    createAuditRecord({
      templateId: proposal.templateId,
      templateVersion: newVersion,
      proposalId: proposal.id,
      proposalTitle: `${proposal.parameter}: ${proposal.suggestedValue}`,
      parameter: proposal.parameter,
      oldValue: String(oldValue),
      newValue: String(convertedValue),
      approvedBy: null,
      evidenceSnapshot: {
        executions: proposal.evidence.executions,
        successRate: proposal.evidence.successRate,
        confidence: proposal.confidence,
        score: proposal.confidence,
      },
    }, db)

    return {
      templateId: proposal.templateId,
      oldVersion: template.metadata.templateVersion,
      newVersion,
      proposalId: proposal.id,
      parameter: proposal.parameter,
      oldValue,
      newValue: convertedValue,
    }
  }
}

function convertToType(value: string | null | undefined, type: TemplateParameter["type"]): unknown {
  if (value === null || value === undefined) return undefined
  switch (type) {
    case "number": {
      const n = Number(value)
      return isNaN(n) ? value : n
    }
    case "boolean": {
      if (value === "true") return true
      if (value === "false") return false
      return value
    }
    case "json": {
      try { return JSON.parse(value) } catch { return value }
    }
    default:
      return value
  }
}

function bumpVersion(current: string): string {
  const parts = current.split(".")
  const major = parseInt(parts[0] ?? "1", 10)
  const minor = parseInt(parts[1] ?? "0", 10)
  const patch = parseInt(parts[2] ?? "0", 10)
  return `${major}.${minor + 1}.${patch}`
}
