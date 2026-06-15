export interface StrategyInput {
  goal: string;
  context: Record<string, unknown>;
  availableActions: Array<{ name: string; description: string }>;
  history: Array<{ action: string; outcome: string }>;
  signal?: AbortSignal;
}

export interface StrategyStep {
  thought: string;
  action: string;
  args: Record<string, unknown>;
  expectedOutcome: string;
}

export interface StrategyOutput {
  steps: StrategyStep[];
  finalAnswer: string;
  reasoning: string;
  confidence: number;
}

export interface ThinkingStrategy {
  readonly name: string;
  readonly description: string;
  think(input: StrategyInput): AsyncGenerator<StrategyStep, StrategyOutput, unknown>;
}

export type StrategyFactory = () => ThinkingStrategy;
