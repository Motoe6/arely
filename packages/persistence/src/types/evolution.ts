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
