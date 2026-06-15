export const TASK_TYPES = [
  "coding",
  "debugging",
  "planning",
  "research",
  "search",
  "translation",
  "conversation",
  "tool_use",
  "agentic",
  "cheap",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export interface TaskProfile {
  type: TaskType;
  complexity: number;
  estimatedTokens: number;
  needsTools: boolean;
}

export interface ModelPerformanceSnapshot {
  provider: string;
  model: string;
  taskType: TaskType;
  executions: number;
  successRate: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  confidence: number;
}

export interface ModelRecommendation {
  provider: string;
  model: string;
  score: number;
  expectedSuccess: number;
  expectedCost: number;
  expectedLatency: number;
  confidence: number;
  rationale: string;
}

export interface ExecutionFeedback {
  taskType: TaskType;
  provider: string;
  model: string;
  success: boolean;
  latencyMs: number;
  costUsd: number;
  tokensUsed: number;
}

export const SCORE_WEIGHTS = {
  successRate: 0.6,
  cost: 0.15,
  latency: 0.15,
  confidence: 0.1,
} as const;
