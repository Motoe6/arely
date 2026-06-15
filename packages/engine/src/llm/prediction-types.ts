export interface PlanningContext {
  taskType: string;
  strategy: string;
  provider: string;
  model: string;
  estimatedTokens: number;
  needsTools: boolean;
  toolNames: string[];
}

export interface ExecutionPrediction {
  successProbability: number;
  expectedCostUsd: number;
  expectedLatencyMs: number;
  confidence: number;
  risk: "low" | "medium" | "high";
  rationale: string[];
}

export interface ForecastRecord {
  predicted: number;
  actual: 0 | 1;
  taskType: string;
  strategy: string;
  model: string;
  provider: string;
  timestamp: number;
}

export interface ForecastError {
  predicted: number;
  actual: 0 | 1;
  error: number;
  absoluteError: number;
}

export interface CalibrationStats {
  key: string;
  observations: number;
  predictionBias: number;
  calibrationError: number;
  brierScore: number;
}
