export type SwarmTaskCategory = "research" | "coding" | "analysis" | "writing";

export type Complexity = "low" | "medium" | "high";

export interface ManagerTask {
  taskId: string;
  title: string;
  description: string;
  category: SwarmTaskCategory;
  dependencies: string[];
  priority: number;
  estimatedComplexity: Complexity;
}

export interface TaskPlan {
  planId: string;
  sessionId: string;
  tasks: ManagerTask[];
  createdAt: number;
}

export interface SubSwarmResult {
  taskId: string;
  category: SwarmTaskCategory;
  output: string;
  durationMs: number;
  assignments: Array<{ role: string; provider: string; model: string }>;
  error?: string;
}

export interface ManagerResult {
  sessionId: string;
  goal: string;
  plan: TaskPlan;
  subResults: SubSwarmResult[];
  synthesis: string;
  durationMs: number;
  memoryIds: string[];
  success: boolean;
  stored: boolean;
  errors: string[];
}

export interface ManagerRecoveryOptions {
  maxRetries: number;
  maxDecompositions: number;
  enableProviderFallback: boolean;
  enableWorkerFallback: boolean;
  enableSingleAgentFallback: boolean;
  fallbackProvider: string;
  fallbackModel: string;
}

export const DEFAULT_RECOVERY_OPTIONS: ManagerRecoveryOptions = {
  maxRetries: 2,
  maxDecompositions: 1,
  enableProviderFallback: true,
  enableWorkerFallback: true,
  enableSingleAgentFallback: true,
  fallbackProvider: "openai",
  fallbackModel: "gpt-4o",
};

export const CATEGORY_PRIORITY: Record<SwarmTaskCategory, number> = {
  research: 1,
  analysis: 2,
  coding: 3,
  writing: 4,
};

export const COMPLEXITY_WEIGHT: Record<Complexity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};
