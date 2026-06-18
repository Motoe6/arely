export type ExecutionStrategy =
  | "single"
  | "swarm"
  | "shared-memory-swarm"
  | "hierarchical"
  | "distributed";

export interface TaskProfile {
  type: string;
  complexity: number;
  estimatedTokens: number;
  needsTools: boolean;
}

export interface WorkerLoadSnapshot {
  totalWorkers: number;
  onlineWorkers: number;
  activeRoles: number;
  avgLatencyMs: number;
  failureRate: number;
}

export interface HistoricalModeData {
  successRate: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  utility: number;
  scenarioCount: number;
}

export interface ModeBreakdown {
  benchmarkScore: number;
  utility: number;
  costEfficiency: number;
  latencyScore: number;
  contextMatch: number;
  memoryAffinity: number;
  clusterLoad: number;
}

export interface ModeScore {
  mode: ExecutionStrategy;
  total: number;
  breakdown: ModeBreakdown;
  reason: string;
}

export interface RoleSelectionResult {
  scores: ModeScore[];
  recommended: ExecutionStrategy;
  runnerUp: ExecutionStrategy;
  reasoning: string;
  taskContext: TaskProfile;
  timestamp: string;
}

export interface RoleSelectorOptions {
  taskClassifier?: (text: string) => TaskProfile;
  searchMemory?: (query: string, limit?: number) => Promise<Array<{ content: string; score: number }>>;
  getWorkerLoad?: () => Promise<WorkerLoadSnapshot>;
  getHistoricalData?: (mode: ExecutionStrategy, taskType: string) => HistoricalModeData | null;
  getPolicyValue?: (name: string) => unknown;
  recordDecision?: (goal: string, selected: ExecutionStrategy, scores: ModeBreakdown) => Promise<void>;
  defaultMode?: ExecutionStrategy;
}

const DEFAULT_WEIGHTS = {
  benchmarkScore: 0.30,
  utility: 0.20,
  costEfficiency: 0.15,
  latencyScore: 0.15,
  contextMatch: 0.10,
  memoryAffinity: 0.05,
  clusterLoad: 0.05,
};

interface BenchmarkBaseline {
  utility: number;
  costUsd: number;
  latencyMs: number;
  costEfficiency: number;
}

const MODE_BASELINES: Record<ExecutionStrategy, BenchmarkBaseline> = {
  "single":              { utility: 0.55, costUsd: 0.005,  latencyMs: 8,   costEfficiency: 32.0 },
  "swarm":               { utility: 0.66, costUsd: 0.0084, latencyMs: 21,  costEfficiency: 19.0 },
  "shared-memory-swarm": { utility: 0.62, costUsd: 0.0084, latencyMs: 9,   costEfficiency: 19.0 },
  "hierarchical":        { utility: 0.71, costUsd: 0.0252, latencyMs: 6,   costEfficiency: 6.35 },
  "distributed":         { utility: 0.64, costUsd: 0.021,  latencyMs: 10,  costEfficiency: 7.62 },
};

const TASK_MODE_PREFERENCE: Record<string, Partial<Record<ExecutionStrategy, number>>> = {
  "coding":       { hierarchical: 1.0, distributed: 0.7, swarm: 0.5, "shared-memory-swarm": 0.4, single: 0.3 },
  "research":     { swarm: 0.9, hierarchical: 0.8, distributed: 0.6, "shared-memory-swarm": 0.5, single: 0.4 },
  "planning":     { hierarchical: 1.0, swarm: 0.7, "shared-memory-swarm": 0.5, distributed: 0.5, single: 0.4 },
  "analysis":     { hierarchical: 0.9, distributed: 0.7, swarm: 0.6, "shared-memory-swarm": 0.5, single: 0.3 },
  "writing":      { "shared-memory-swarm": 1.0, hierarchical: 0.9, swarm: 0.7, single: 0.5, distributed: 0.3 },
  "tool-use":     { single: 0.9, swarm: 0.6, "shared-memory-swarm": 0.6, hierarchical: 0.4, distributed: 0.3 },
  "creative":     { swarm: 1.0, "shared-memory-swarm": 0.8, hierarchical: 0.6, single: 0.4, distributed: 0.2 },
  "conversation": { "shared-memory-swarm": 1.0, single: 0.8, swarm: 0.5, hierarchical: 0.3, distributed: 0.2 },
};

const MAX_LATENCY_MS = 100;

export class DynamicRoleSelector {
  private weights = { ...DEFAULT_WEIGHTS };
  private options: RoleSelectorOptions;

  constructor(options: RoleSelectorOptions = {}) {
    this.options = options;
  }

  async selectRole(goal: string): Promise<RoleSelectionResult> {
    const taskContext = await this.classifyTask(goal);

    if (this.options.getPolicyValue) {
      const policyVal = this.options.getPolicyValue("defaultExecutionMode");
      const policyMode = typeof policyVal === "string" ? policyVal as ExecutionStrategy : undefined;
      const allowedModes: ExecutionStrategy[] = ["single", "swarm", "shared-memory-swarm", "hierarchical", "distributed"];
      if (policyMode && allowedModes.includes(policyMode)) {
        return this.buildSingleResult(policyMode, taskContext, "forced by policy");
      }
    }

    const scores: ModeScore[] = [];
    const allModes: ExecutionStrategy[] = ["single", "swarm", "shared-memory-swarm", "hierarchical", "distributed"];

    for (const mode of allModes) {
      const score = await this.computeScore(mode, taskContext, goal);
      scores.push(score);
    }

    scores.sort((a, b) => b.total - a.total);

    const recommended = scores[0];
    const runnerUp = scores[1];

    if (this.options.recordDecision) {
      await this.options.recordDecision(goal, recommended.mode, recommended.breakdown);
    }

    return {
      scores,
      recommended: recommended.mode,
      runnerUp: runnerUp.mode,
      reasoning: recommended.reason,
      taskContext,
      timestamp: new Date().toISOString(),
    };
  }

  private async classifyTask(goal: string): Promise<TaskProfile> {
    if (this.options.taskClassifier) {
      return this.options.taskClassifier(goal);
    }
    return this.classifyText(goal);
  }

  private classifyText(text: string): TaskProfile {
    const lower = text.toLowerCase();

    let type = "research";
    if (/\b(code|implement|build|develop|program|write\s.+(function|class|api|app|script))\b/.test(lower))
      type = "coding";
    else if (/\b(analy(s|z)e|compare|evaluate|assess|review|audit|benchmark)\b/.test(lower))
      type = "analysis";
    else if (/\b(plan|strategy|roadmap|architect|design|proposal)\b/.test(lower))
      type = "planning";
    else if (/\b(write|document|report|draft|summarize|explain|describe)\b/.test(lower))
      type = "writing";
    else if (/\b(chat|talk|convers|discuss)\b/.test(lower))
      type = "conversation";
    else if (/\b(brainstorm|creative|idea|imagine|design)\b/.test(lower))
      type = "creative";
    else if (/\b(search|find|lookup|get|fetch|tool)\b/.test(lower))
      type = "tool-use";

    const complexity = this.estimateComplexity(lower);
    const needsTools = /\b(tool|search|fetch|read|write|file|execute|run|shell|bash|powershell)\b/.test(lower);
    const estimatedTokens = Math.min(complexity * 200, 128000);

    return { type, complexity, estimatedTokens, needsTools };
  }

  private estimateComplexity(text: string): number {
    const length = text.length;
    const complexWords = (text.match(/\b(complex|large|distributed|multi|scale|enterprise|advanced|comprehensive|architecture|infrastructure|integration|deployment)\b/gi) || []).length;
    const score = Math.min(100, Math.round(length / 10 + complexWords * 15));
    return score;
  }

  private async computeScore(mode: ExecutionStrategy, task: TaskProfile, goal: string): Promise<ModeScore> {
    const historical = await this.getHistoricalData(mode, task.type);

    const benchmarkScore = this.computeBenchmarkScore(mode, historical, task);
    const utility = this.computeUtility(mode, historical);
    const costEfficiency = this.computeCostEfficiency(mode, historical);
    const latencyScore = this.computeLatencyScore(mode, task, historical);
    const contextMatch = this.computeContextMatch(mode, task);
    const memoryAffinity = await this.computeMemoryAffinity(mode, goal);
    const clusterLoad = await this.computeClusterLoad(mode);

    const breakdown: ModeBreakdown = {
      benchmarkScore,
      utility,
      costEfficiency,
      latencyScore,
      contextMatch,
      memoryAffinity,
      clusterLoad,
    };

    const total =
      this.weights.benchmarkScore * benchmarkScore +
      this.weights.utility * utility +
      this.weights.costEfficiency * costEfficiency +
      this.weights.latencyScore * latencyScore +
      this.weights.contextMatch * contextMatch +
      this.weights.memoryAffinity * memoryAffinity +
      this.weights.clusterLoad * clusterLoad;

    const reason = this.buildReason(mode, total, breakdown, task);

    return { mode, total, breakdown, reason };
  }

  private computeBenchmarkScore(mode: ExecutionStrategy, historical: HistoricalModeData | null, task: TaskProfile): number {
    if (historical && historical.scenarioCount > 0 && historical.successRate > 0) {
      return Math.min(1, historical.successRate * 0.7 + historical.utility * 0.3);
    }
    const base = MODE_BASELINES[mode];
    const complexityPenalty = task.complexity > 70 && mode === "single" ? 0.2 : 0;
    return Math.max(0, Math.min(1, base.utility - complexityPenalty));
  }

  private computeUtility(mode: ExecutionStrategy, historical: HistoricalModeData | null): number {
    if (historical && historical.scenarioCount > 0) return historical.utility;
    return MODE_BASELINES[mode].utility;
  }

  private computeCostEfficiency(mode: ExecutionStrategy, historical: HistoricalModeData | null): number {
    if (historical && historical.avgCostUsd > 0) {
      return Math.min(1, 0.05 / historical.avgCostUsd / 10);
    }
    const base = MODE_BASELINES[mode];
    return Math.min(1, 0.05 / base.costUsd / 10);
  }

  private computeLatencyScore(mode: ExecutionStrategy, task: TaskProfile, historical: HistoricalModeData | null): number {
    const latency = historical && historical.avgLatencyMs > 0 ? historical.avgLatencyMs : MODE_BASELINES[mode].latencyMs;
    const effectiveLatency = task.complexity > 70 ? latency * 1.5 : latency;
    return Math.max(0, 1 - effectiveLatency / MAX_LATENCY_MS);
  }

  private computeContextMatch(mode: ExecutionStrategy, task: TaskProfile): number {
    const preferences = TASK_MODE_PREFERENCE[task.type];
    if (!preferences) return 0.5;

    const base = preferences[mode] ?? 0.5;

    if (task.complexity > 70) {
      if (mode === "hierarchical") return Math.min(1, base + 0.2);
      if (mode === "single") return Math.max(0, base - 0.2);
    }

    if (task.complexity < 30) {
      if (mode === "single" || mode === "swarm") return Math.min(1, base + 0.15);
      if (mode === "hierarchical") return Math.max(0, base - 0.15);
    }

    if (task.needsTools) {
      if (mode === "single" || mode === "shared-memory-swarm") return Math.min(1, base + 0.1);
    }

    return base;
  }

  private async computeMemoryAffinity(mode: ExecutionStrategy, goal: string): Promise<number> {
    if (!this.options.searchMemory) return 0.5;

    try {
      const results = await this.options.searchMemory(goal, 10);
      if (results.length === 0) return 0.5;

      const relevant = results.filter(r => {
        const lower = r.content.toLowerCase();
        return lower.includes(mode) ||
               lower.includes("execution") ||
               lower.includes("benchmark") ||
               lower.includes("performance");
      });

      if (relevant.length === 0) return 0.5;

      const avgScore = relevant.reduce((sum, r) => sum + r.score, 0) / relevant.length;
      return Math.min(1, avgScore * 1.5);
    } catch {
      return 0.5;
    }
  }

  private async computeClusterLoad(mode: ExecutionStrategy): Promise<number> {
    if (!this.options.getWorkerLoad) return 0.5;

    try {
      const load = await this.options.getWorkerLoad();

      if (load.totalWorkers === 0) return mode === "distributed" ? 0.1 : 0.5;

      const utilization = load.onlineWorkers > 0 ? load.activeRoles / load.onlineWorkers : 0;

      if (utilization > 0.8) {
        if (mode === "distributed") return 0.2;
        if (mode === "hierarchical") return 0.4;
        return 0.6;
      }

      if (utilization > 0.5) {
        if (mode === "distributed") return 0.6;
        return 0.8;
      }

      return 1.0;
    } catch {
      return 0.5;
    }
  }

  private async getHistoricalData(mode: ExecutionStrategy, taskType: string): Promise<HistoricalModeData | null> {
    if (this.options.getHistoricalData) {
      return this.options.getHistoricalData(mode, taskType);
    }
    return null;
  }

  private buildReason(mode: ExecutionStrategy, total: number, breakdown: ModeBreakdown, task: TaskProfile): string {
    const parts: string[] = [];

    const dominantFactors: Array<[string, number]> = [
      ["benchmark score", this.weights.benchmarkScore * breakdown.benchmarkScore],
      ["utility", this.weights.utility * breakdown.utility],
      ["cost efficiency", this.weights.costEfficiency * breakdown.costEfficiency],
      ["latency", this.weights.latencyScore * breakdown.latencyScore],
      ["context match", this.weights.contextMatch * breakdown.contextMatch],
    ];
    dominantFactors.sort((a, b) => b[1] - a[1]);

    const top = dominantFactors.slice(0, 2);
    if (top[0][1] > 0.1) parts.push(`${top[0][0]} (${(top[0][1] * 100).toFixed(0)}%)`);
    if (top[1][1] > 0.08) parts.push(`${top[1][0]} (${(top[1][1] * 100).toFixed(0)}%)`);

    parts.push(`task type: ${task.type}`);

    return `${mode}: ${(total * 100).toFixed(1)}% — ${parts.join(", ")}`;
  }

  private buildSingleResult(mode: ExecutionStrategy, task: TaskProfile, reason: string): RoleSelectionResult {
    const base = MODE_BASELINES[mode];
    const score: ModeScore = {
      mode,
      total: 1.0,
      breakdown: {
        benchmarkScore: base.utility,
        utility: base.utility,
        costEfficiency: this.computeCostEfficiency(mode, null),
        latencyScore: this.computeLatencyScore(mode, task, null),
        contextMatch: 1.0,
        memoryAffinity: 0.5,
        clusterLoad: 0.5,
      },
      reason: `${mode} (forced by policy)`,
    };

    return {
      scores: [score],
      recommended: mode,
      runnerUp: mode,
      reasoning: reason,
      taskContext: task,
      timestamp: new Date().toISOString(),
    };
  }

  updateWeights(weights: Partial<typeof DEFAULT_WEIGHTS>): void {
    this.weights = { ...this.weights, ...weights };
  }
}
