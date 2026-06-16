import { getDb, modelPerformance } from "@arelyos/persistence";
import { eq, and, desc } from "drizzle-orm";
import { ulid } from "ulid";
import { decisionService } from "./decision-service.js";
import type { ModelPerformanceSnapshot, TaskType } from "./model-selection-types.js";
import { TASK_TYPES, SCORE_WEIGHTS } from "./model-selection-types.js";

export type { TaskType };
export { TASK_TYPES };

const CONFIDENCE_THRESHOLD = 30;

export interface ModelPerfRecord {
  id: string;
  model: string;
  provider: string;
  taskType: string;
  successes: number;
  failures: number;
  avgLatencyMs: number | null;
  totalTokens: number | null;
  totalCostUsd: number | null;
  totalDecisions: number;
  confidence: number;
  updatedAt: string;
}

export class ModelPerformanceService {
  async recordExecution(
    model: string,
    provider: string,
    taskType: string,
    success: boolean,
    latencyMs?: number,
    tokens?: number,
    costUsd?: number,
  ): Promise<void> {
    const db = getDb();
    const existing = db
      .select()
      .from(modelPerformance)
      .where(and(
        eq(modelPerformance.model, model),
        eq(modelPerformance.provider, provider),
        eq(modelPerformance.taskType, taskType),
      ))
      .get();

    if (existing) {
      const newTotal = existing.totalDecisions + 1;
      const newSuccesses = existing.successes + (success ? 1 : 0);
      const newFailures = existing.failures + (success ? 0 : 1);
      const newAvgLatency =
        latencyMs !== undefined
          ? Math.round(
              ((existing.avgLatencyMs ?? 0) * existing.totalDecisions + latencyMs) / newTotal,
            )
          : existing.avgLatencyMs;
      const newTokens =
        tokens !== undefined
          ? (existing.totalTokens ?? 0) + tokens
          : existing.totalTokens;
      const newCost =
        costUsd !== undefined
          ? (existing.totalCostUsd ?? 0) + costUsd
          : existing.totalCostUsd;
      const confidence = Math.min(100, Math.round((newTotal / CONFIDENCE_THRESHOLD) * 100));

      db.update(modelPerformance)
        .set({
          successes: newSuccesses,
          failures: newFailures,
          avgLatencyMs: newAvgLatency,
          totalTokens: newTokens,
          totalCostUsd: newCost,
          totalDecisions: newTotal,
          confidence,
        })
        .where(eq(modelPerformance.id, existing.id))
        .run();
    } else {
      const confidence = Math.min(100, Math.round((1 / CONFIDENCE_THRESHOLD) * 100));
      db.insert(modelPerformance)
        .values({
          id: ulid(),
          model,
          provider,
          taskType,
          successes: success ? 1 : 0,
          failures: success ? 0 : 1,
          avgLatencyMs: latencyMs ?? null,
          totalTokens: tokens ?? null,
          totalCostUsd: costUsd ?? null,
          totalDecisions: 1,
          confidence,
        })
        .run();
    }
  }

  async recordFromDecision(decisionId: string): Promise<void> {
    const decision = decisionService.getDecision(decisionId);
    if (!decision) return;

    const meta = decision.metadata ?? {};
    const model = meta.model as string | undefined;
    const provider = meta.provider as string | undefined;
    const taskType = (meta.taskType as string) ?? this.inferTaskType(decision.decisionType);

    if (!model) return;

    const success = decision.outcome === "success";
    const latencyMs =
      (meta.latencyMs as number | undefined) ??
      (typeof meta.latency === "number" ? meta.latency : undefined);
    const tokens =
      (meta.tokens as number | undefined) ??
      (meta.totalTokens as number | undefined);
    const costUsd = meta.costUsd as number | undefined;

    await this.recordExecution(model, provider ?? "unknown", taskType, success, latencyMs, tokens, costUsd);
  }

  getModelPerformance(filters?: {
    model?: string;
    provider?: string;
    taskType?: string;
    minConfidence?: number;
  }): ModelPerfRecord[] {
    const db = getDb();
    const conditions: any[] = [];

    if (filters?.model) conditions.push(eq(modelPerformance.model, filters.model));
    if (filters?.provider) conditions.push(eq(modelPerformance.provider, filters.provider));
    if (filters?.taskType) conditions.push(eq(modelPerformance.taskType, filters.taskType));

    let query: any = db.select().from(modelPerformance);
    if (conditions.length > 0) query = query.where(and(...conditions));

    const rows = query.orderBy(desc(modelPerformance.totalDecisions)).all() as unknown as ModelPerfRecord[];

    if (filters?.minConfidence !== undefined) {
      return rows.filter((r) => r.confidence >= filters.minConfidence!);
    }
    return rows;
  }

  getSnapshots(taskType?: TaskType): ModelPerformanceSnapshot[] {
    const rows = this.getModelPerformance(taskType ? { taskType } : undefined);
    return rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      taskType: r.taskType as TaskType,
      executions: r.totalDecisions,
      successRate: r.totalDecisions > 0 ? r.successes / r.totalDecisions : 0,
      avgLatencyMs: r.avgLatencyMs ?? 0,
      avgCostUsd: r.totalDecisions > 0 && r.totalCostUsd !== null
        ? r.totalCostUsd / r.totalDecisions
        : 0,
      confidence: r.confidence / 100,
    }));
  }

  getBestModel(
    taskType: string,
    minConfidence: number = 0,
  ): ModelPerfRecord | null {
    const results = this.getModelPerformance({ taskType, minConfidence });
    if (results.length === 0) return null;

    const successRate = (r: ModelPerfRecord) =>
      r.totalDecisions > 0 ? r.successes / r.totalDecisions : 0;

    const sorted = [...results].sort((a, b) => {
      const rateDiff = successRate(b) - successRate(a);
      if (Math.abs(rateDiff) > 0.01) return rateDiff;
      return b.totalDecisions - a.totalDecisions;
    });

    return sorted[0] ?? null;
  }

  recommendModel(taskType: string): string | null {
    const best = this.getBestModel(taskType);
    if (!best) return null;

    const rate =
      best.totalDecisions > 0
        ? ((best.successes / best.totalDecisions) * 100).toFixed(0)
        : "0";

    return `${best.model} (${rate}% success, ${best.totalDecisions} executions, ${(best.confidence / 100).toFixed(1)} confidence)`;
  }

  getConvergence(taskType?: string): Array<{
    model: string;
    provider: string;
    taskType: string;
    observations: number;
    successRate: number;
    confidence: number;
  }> {
    const results = this.getModelPerformance(taskType ? { taskType } : undefined);
    return results.map((r) => ({
      model: r.model,
      provider: r.provider,
      taskType: r.taskType,
      observations: r.totalDecisions,
      successRate: r.totalDecisions > 0 ? r.successes / r.totalDecisions : 0,
      confidence: r.confidence / 100,
    }));
  }

  getAllRecommendations(): string[] {
    const lines: string[] = [];
    for (const tt of TASK_TYPES) {
      const rec = this.recommendModel(tt);
      if (rec) lines.push(`  ${tt} \u2192 ${rec}`);
    }
    return lines;
  }

  private inferTaskType(decisionType: string): string {
    const lower = decisionType.toLowerCase();
    if (lower.includes("code") || lower.includes("implement")) return "coding";
    if (lower.includes("debug") || lower.includes("fix") || lower.includes("error")) return "debugging";
    if (lower.includes("plan") || lower.includes("design")) return "planning";
    if (lower.includes("research") || lower.includes("search") || lower.includes("find")) return "research";
    if (lower.includes("translat")) return "translation";
    if (lower.includes("tool") || lower.includes("command") || lower.includes("exec")) return "tool_use";
    if (lower.includes("agent")) return "agentic";
    return "conversation";
  }
}

export const modelPerformanceService = new ModelPerformanceService();
