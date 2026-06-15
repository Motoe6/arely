import type { PlanningContext, ExecutionPrediction } from "./prediction-types.js";
import type { GoalForecast, GoalForecastContext } from "./goal-forecast-types.js";
import { queryDecisions } from "@arely/persistence";
import { GoalUtilityScorer } from "./goal-utility-scorer.js";

const COMPLEXITY_PENALTY: Record<string, number> = {
  cheap: 1.0,
  conversation: 0.95,
  search: 0.90,
  research: 0.85,
  planning: 0.80,
  coding: 0.75,
  debugging: 0.70,
  translation: 0.70,
  tool_use: 0.65,
  agentic: 0.65,
};

const DEFAULT_COMPLEXITY_PENALTY = 0.70;

export class ExecutionForecaster {
  constructor(
    private getStrategyScore: (strategy: string) => number,
    private getModelScore: (model: string, provider: string, taskType: string) => number,
  ) {}

  predict(ctx: PlanningContext): ExecutionPrediction {
    const strategyScore = this.getStrategyScore(ctx.strategy);
    const modelScore = this.getModelScore(ctx.model, ctx.provider, ctx.taskType);
    const toolScore = ctx.needsTools ? this.computeToolScore(ctx.toolNames) : 1;
    const complexityPenalty = COMPLEXITY_PENALTY[ctx.taskType] ?? DEFAULT_COMPLEXITY_PENALTY;

    const raw = strategyScore * modelScore * toolScore * complexityPenalty;
    const successProbability = Math.min(1, Math.max(0, raw));

    const expectedCostUsd = this.estimateCost(ctx);
    const expectedLatencyMs = this.estimateLatency(ctx);

    const confidence = this.computeConfidence(strategyScore, modelScore, toolScore);

    const risk = successProbability >= 0.85 ? "low" : successProbability >= 0.6 ? "medium" : "high";

    const rationale = this.buildRationale(ctx, strategyScore, modelScore, toolScore, complexityPenalty, successProbability);

    return { successProbability, expectedCostUsd, expectedLatencyMs, confidence, risk, rationale };
  }

  forecastGoalUtility(ctx: GoalForecastContext): GoalForecast {
    const scorer = new GoalUtilityScorer();
    return scorer.score(ctx);
  }

  forecastGoalUtilityForPlan(goalId: string, planCtx: PlanningContext): GoalForecast {
    const prediction = this.predict(planCtx);
    const scorer = new GoalUtilityScorer();
    return scorer.scoreGoal(goalId, prediction);
  }

  private computeToolScore(toolNames: string[]): number {
    if (toolNames.length === 0) return 1;

    const toolDecisions = queryDecisions({ decisionType: "tool_use", limit: 200 });
    const toolResults = new Map<string, { successes: number; total: number }>();

    for (const d of toolDecisions) {
      const meta = d.metadata ?? {};
      const tn = meta.toolName as string | undefined;
      if (!tn) continue;
      if (!toolNames.includes(tn)) continue;

      let r = toolResults.get(tn);
      if (!r) {
        r = { successes: 0, total: 0 };
        toolResults.set(tn, r);
      }
      r.total++;
      if (d.outcome === "success") r.successes++;
    }

    if (toolResults.size === 0) return 0.90;

    let totalScore = 0;
    let count = 0;
    for (const [, r] of toolResults) {
      const rate = r.total > 0 ? r.successes / r.total : 0.5;
      totalScore += rate;
      count++;
    }
    return totalScore / count;
  }

  private estimateCost(ctx: PlanningContext): number {
    const tokens = ctx.estimatedTokens;
    return (tokens / 1_000_000) * 5;
  }

  private estimateLatency(ctx: PlanningContext): number {
    const perTokenMs = ctx.needsTools ? 0.03 : 0.02;
    return Math.round(ctx.estimatedTokens * perTokenMs);
  }

  private computeConfidence(strategyScore: number, modelScore: number, toolScore: number): number {
    const factors = [strategyScore, modelScore, toolScore];
    const avg = factors.reduce((s, v) => s + v, 0) / factors.length;
    return Math.round(avg * 100) / 100;
  }

  private buildRationale(
    ctx: PlanningContext,
    strategyScore: number,
    modelScore: number,
    toolScore: number,
    complexityPenalty: number,
    successProbability: number,
  ): string[] {
    const lines: string[] = [];
    lines.push(`${ctx.strategy} performs at ${(strategyScore * 100).toFixed(0)}%`);
    lines.push(`${ctx.model} (${ctx.provider}) performs at ${(modelScore * 100).toFixed(0)}%`);
    if (ctx.needsTools) {
      lines.push(`tools score ${(toolScore * 100).toFixed(0)}%`);
    }
    lines.push(`${ctx.taskType} complexity penalty: ${(complexityPenalty * 100).toFixed(0)}%`);
    lines.push(`predicted success: ${(successProbability * 100).toFixed(0)}%`);
    return lines;
  }
}
