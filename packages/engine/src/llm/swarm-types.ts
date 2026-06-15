export type AgentRole = "planner" | "coder" | "reviewer"

export interface SwarmStepResult {
  role: AgentRole
  output: string
}

export interface SwarmResult {
  request: string
  steps: SwarmStepResult[]
  plan: string
  code: string
  review: string
}
