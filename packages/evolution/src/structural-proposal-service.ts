import { createProposal, getProposal, listProposals, updateProposalStatus } from "@arely/persistence"
import type { ProposalRecord, ProposalStatus } from "@arely/persistence"
import type { StructuralEvolutionProposal } from "./structural-evolution-types.js"

type DbClient = any

export class StructuralProposalService {

  persist(source: StructuralEvolutionProposal, db?: DbClient): ProposalRecord {
    return createProposal({
      templateId: source.templateId,
      type: "structural",
      parameter: source.kind,
      currentValue: source.title,
      suggestedValue: source.description,
      confidence: source.confidence,
      evidence: {
        executions: source.evidence.sampleExecutions,
        successRate: source.evidence.avgSuccessRate,
        pattern: source.evidence.pattern,
        avgConfidence: source.evidence.avgConfidence,
        sampleExecutions: source.evidence.sampleExecutions,
      },
    }, db)
  }

  list(opts?: { status?: ProposalStatus; templateId?: string; db?: DbClient }): ProposalRecord[] {
    return listProposals({ ...opts, type: "structural" })
  }

  get(id: string, db?: DbClient): ProposalRecord | null {
    const p = getProposal(id, db)
    if (!p || p.type !== "structural") return null
    return p
  }

  approve(id: string, db?: DbClient): ProposalRecord | null {
    return updateProposalStatus(id, "approved", db)
  }

  reject(id: string, db?: DbClient): ProposalRecord | null {
    return updateProposalStatus(id, "rejected", db)
  }
}
