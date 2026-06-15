export type ScenarioCategory = "coding" | "research" | "planning" | "tool-use" | "swarm";
export type BenchmarkMode = "single" | "planner" | "swarm" | "shared-memory-swarm";

export interface Scenario {
  id: string;
  category: ScenarioCategory;
  title: string;
  tags: string[];
  difficulty: string;
  successCriteria: string[];
  expectedToolCalls: number;
  expectedTokensMax: number;
  swarmRoles?: string[];
  prompt: string;
}

export interface ScenarioRunResult {
  scenarioId: string;
  scenarioTitle: string;
  mode: BenchmarkMode;
  success: boolean;
  latencyMs: number;
  costUsd: number;
  goalProgressGain: number;
  expectedUtility: number;
  predictionError: number;
  toolCalls: number;
  tokens: number;
  turns: number;
  error?: string;
}

export interface ScenarioSummary {
  scenario: string;
  mode: string;
  success: string;
  latency: string;
  cost: string;
  gain: string;
}
