export interface EvolutionProposal {
  id: string
  templateId: string
  type: "parameter_change" | "parameter_removal" | "parameter_addition"
  parameter: string
  currentValue?: string
  suggestedValue?: string
  confidence: number
  evidence: {
    executions: number
    successRate: number
  }
  createdAt: string
}

export interface EvolutionProposalsResult {
  templateId: string
  proposals: EvolutionProposal[]
}

export interface EvidenceSnapshot {
  executions: number
  successRate: number
  confidence: number
  score: number
}

export interface EvolutionAuditRecord {
  id: string
  templateId: string
  templateVersion: string
  proposalId: string
  proposalTitle: string | null
  parameter: string
  oldValue: string | null
  newValue: string | null
  approvedBy: string | null
  evidenceSnapshot: EvidenceSnapshot
  createdAt: string
}
