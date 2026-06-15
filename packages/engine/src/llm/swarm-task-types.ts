export type SwarmAgentRole = "planner" | "researcher" | "coder" | "reviewer" | "synthesizer"

export interface SwarmTask {
  id: string
  role: SwarmAgentRole
  goal: string
  dependencies: string[]
  instructions: string
}

export interface TaskGraph {
  tasks: SwarmTask[]
  phases: string[][]
}

export interface AgentContribution {
  role: SwarmAgentRole
  taskId: string
  content: string
  timestamp: number
}

export interface SharedMemoryOptions {
  goalResume?: string
  relevantMemories?: string
  decisionHistory?: string
  customContext?: string
}

export interface ParallelSwarmResult {
  request: string
  plan: string
  tasks: SwarmTask[]
  outputs: Record<string, string>
  review: string
  synthesis: string
  contributions: AgentContribution[]
}
