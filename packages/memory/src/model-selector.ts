import type {
  ModelRecommendation,
  TaskProfile,
  ModelPerformanceSnapshot,
  TaskType,
} from "./model-selection-types.js";
import { SCORE_WEIGHTS } from "./model-selection-types.js";
import { ModelPerformanceService } from "./model-performance-service.js";

export class ModelSelector {
  constructor(private perfService: ModelPerformanceService) {}

  recommend(
    profile: TaskProfile,
    candidates: ModelPerformanceSnapshot[],
  ): ModelRecommendation[] {
    const scored = candidates
      .filter((c) => c.taskType === profile.type || c.executions > 0)
      .map((c) => {
        const score = this.computeScore(c);
        return {
          provider: c.provider,
          model: c.model,
          score,
          expectedSuccess: c.successRate,
          expectedCost: c.avgCostUsd,
          expectedLatency: c.avgLatencyMs,
          confidence: c.confidence,
          rationale: this.buildRationale(c, score),
        };
      });

    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return this.defaultFallback(profile.type);
    }

    return scored;
  }

  private computeScore(candidate: ModelPerformanceSnapshot): number {
    const successScore = candidate.successRate * 100;
    const costScore = this.costScore(candidate.avgCostUsd);
    const latencyScore = this.latencyScore(candidate.avgLatencyMs);
    const confidenceScore = candidate.confidence * 100;

    return (
      successScore * SCORE_WEIGHTS.successRate +
      costScore * SCORE_WEIGHTS.cost +
      latencyScore * SCORE_WEIGHTS.latency +
      confidenceScore * SCORE_WEIGHTS.confidence
    );
  }

  private costScore(avgCostUsd: number): number {
    if (avgCostUsd <= 0) return 100;
    if (avgCostUsd <= 0.001) return 90;
    if (avgCostUsd <= 0.005) return 70;
    if (avgCostUsd <= 0.01) return 50;
    if (avgCostUsd <= 0.05) return 30;
    return 10;
  }

  private latencyScore(avgLatencyMs: number): number {
    if (avgLatencyMs <= 0) return 100;
    if (avgLatencyMs <= 500) return 100;
    if (avgLatencyMs <= 1000) return 80;
    if (avgLatencyMs <= 3000) return 60;
    if (avgLatencyMs <= 5000) return 40;
    if (avgLatencyMs <= 10000) return 20;
    return 5;
  }

  private buildRationale(c: ModelPerformanceSnapshot, score: number): string {
    const parts: string[] = [];
    parts.push(`${c.model} (${c.provider}) — score ${score.toFixed(1)}`);
    parts.push(`success ${(c.successRate * 100).toFixed(0)}%`);
    if (c.executions > 0) parts.push(`over ${c.executions} runs`);
    return parts.join(", ");
  }

  private defaultFallback(taskType: TaskType): ModelRecommendation[] {
    const defaults: Array<[string, string, number]> = [
      ["openai", "gpt-4o-mini", 90],
      ["openai", "gpt-4o", 80],
      ["anthropic", "claude-3-haiku", 70],
      ["anthropic", "claude-3.5-sonnet", 60],
    ];

    if (taskType === "cheap") {
      defaults.sort((a, b) => a[2] - b[2]);
    }

    return defaults.map(([provider, model, baseScore]) => ({
      provider,
      model,
      score: baseScore,
      expectedSuccess: 0,
      expectedCost: 0,
      expectedLatency: 0,
      confidence: 0,
      rationale: `No historical data — using default ${model}`,
    }));
  }
}
