export type MetricUnit = "count" | "percent" | "ratio" | "ms" | "usd" | "tokens" | "score" | "bytes"

export interface BenchmarkMetric {
  name: string
  value: number
  unit: MetricUnit
  threshold?: { operator: "lt" | "lte" | "gt" | "gte" | "eq"; value: number }
  passed?: boolean
}

export interface BenchmarkSuite {
  name: string
  description: string
  metrics: BenchmarkMetric[]
  metadata?: Record<string, unknown>
}

export interface BenchmarkSummary {
  totalSuites: number
  totalMetrics: number
  passed: number
  failed: number
  errored: number
}

export interface BenchmarkReport {
  timestamp: string
  suites: BenchmarkSuite[]
  summary: BenchmarkSummary
}

export interface Collector {
  name: string
  description: string
  collect(): BenchmarkSuite | Promise<BenchmarkSuite>
}

export interface BenchmarkOptions {
  provider?: string;
  model?: string;
  jsonOutput?: boolean;
  real?: boolean;
  environment?: "dev" | "ci" | "production";
  concurrency?: number;
  mode?: "standard" | "hierarchical" | "distributed" | "swarm-heterogeneous" | "soak";
  duration?: string; // e.g. "10m", "1h", "24h", "72h", "7d"
  heterogeneous?: boolean;
}

export interface ProviderBenchmarkResult {
  provider: string;
  label: string;
  successRate: number;
  avgLatencyMs: number;
  costUsd: number;
  utility: number;
  score: number;
  costEfficiency: number;
  scenarioCount: number;
  // Reserved for T15.3 Dynamic Role Selection
  bestCodingModel?: string;
  bestResearchModel?: string;
  bestPlanningModel?: string;
  // Sprint 1 hierarchical/distributed
  hierarchicalEfficiency?: number; // success/treeDepth
  distributedEfficiency?: number; // success/workerCount
  learningGain?: number;
  avgTreeDepth?: number;
  avgWorkerUtilization?: number;
}

export interface ProviderLeaderboard {
  overall: ProviderBenchmarkResult[];
  utility: ProviderBenchmarkResult[];
  latency: ProviderBenchmarkResult[];
  cost: ProviderBenchmarkResult[];
  successRate: ProviderBenchmarkResult[];
  costEfficiency: ProviderBenchmarkResult[];
  // Extended leaderboards (Sprint 1)
  hierarchicalEfficiency?: ProviderBenchmarkResult[];
  distributedEfficiency?: ProviderBenchmarkResult[];
  learningGain?: ProviderBenchmarkResult[];
}

export interface ProviderBenchmarkSummary {
  timestamp: string;
  providers: Record<string, {
    successRate: number;
    avgLatencyMs: number;
    costUsd: number;
    utility: number;
    score: number;
    costEfficiency: number;
    scenarioCount: number;
  }>;
  leaderboard: {
    overall: string[];
    utility: string[];
    cost: string[];
    latency: string[];
    successRate: string[];
    costEfficiency: string[];
    hierarchicalEfficiency?: string[];
    distributedEfficiency?: string[];
    learningGain?: string[];
  };
}
