import { queryDecisions } from "@arely/persistence";
import { memoryService } from "./memory-service.js";

export interface StrategyPerformance {
  strategy: string;
  total: number;
  successes: number;
  failures: number;
  pending: number;
  successRate: number;
}

export interface StrategyConvergence {
  strategy: string;
  observations: number;
  successRate: number;
  confidence: number;
  selectedCount: number;
}

export class StrategyEvaluator {
  async getStrategyPerformance(sessionId: string): Promise<StrategyPerformance[]> {
    const all = queryDecisions({ sessionId, limit: 500 });
    const withStrategy = all.filter(
      (d) => d.metadata?.strategy && typeof d.metadata.strategy === "string",
    );

    const grouped = new Map<string, { total: number; successes: number; failures: number; pending: number }>();

    for (const d of withStrategy) {
      const strategy = d.metadata!.strategy as string;
      let g = grouped.get(strategy);
      if (!g) {
        g = { total: 0, successes: 0, failures: 0, pending: 0 };
        grouped.set(strategy, g);
      }
      g.total++;
      if (d.outcome === "success") g.successes++;
      else if (d.outcome === "failure") g.failures++;
      else g.pending++;
    }

    const result: StrategyPerformance[] = [];
    for (const [strategy, g] of grouped) {
      result.push({
        strategy,
        total: g.total,
        successes: g.successes,
        failures: g.failures,
        pending: g.pending,
        successRate: g.total > 0 ? Math.round((g.successes / g.total) * 100) : 0,
      });
    }

    return result.sort((a, b) => b.total - a.total);
  }

  async buildStrategyContext(sessionId: string): Promise<string> {
    const stats = await this.getStrategyPerformance(sessionId);
    if (stats.length === 0) return "";

    const lines = stats.map(
      (s) => `  ${s.strategy}: ${s.successes}/${s.total} successful (${s.successRate}%)`,
    );

    const total = stats.reduce((s, g) => s + g.total, 0);
    const successes = stats.reduce((s, g) => s + g.successes, 0);
    const overallRate = total > 0 ? Math.round((successes / total) * 100) : 0;

    return `[Strategy Performance]\n${lines.join("\n")}\n  Overall: ${successes}/${total} (${overallRate}%)`;
  }

  async getStrategyConvergence(sessionId: string): Promise<StrategyConvergence[]> {
    const stats = await this.getStrategyPerformance(sessionId);

    const totalObs = stats.reduce((s, g) => s + g.total, 0);
    const selectedCounts = new Map<string, number>();
    for (const s of stats) {
      selectedCounts.set(s.strategy, s.total);
    }

    const STABLE_THRESHOLD = 30;

    return stats.map((s) => ({
      strategy: s.strategy,
      observations: s.total,
      successRate: s.successRate,
      confidence: Math.min(1, s.total / STABLE_THRESHOLD),
      selectedCount: selectedCounts.get(s.strategy) ?? 0,
    })).sort((a, b) => b.observations - a.observations);
  }

  async storeStrategySummary(sessionId: string): Promise<void> {
    const stats = await this.getStrategyPerformance(sessionId);
    if (stats.length === 0) return;

    const lines = stats.map(
      (s) => `${s.strategy}: ${s.successes}/${s.total} (${s.successRate}%)`,
    );

    const total = stats.reduce((s, g) => s + g.total, 0);
    const successes = stats.reduce((s, g) => s + g.successes, 0);
    const overallRate = total > 0 ? Math.round((successes / total) * 100) : 0;

    const summary = `Session strategy performance:\n${lines.join("\n")}\nOverall: ${successes}/${total} (${overallRate}%)`;

    await memoryService.setMemory(
      sessionId,
      "conversation_summary",
      `strategy_performance_${sessionId.slice(0, 8)}`,
      summary,
      Math.min(95, overallRate),
      "derived",
      ["auto-learned", "strategy-performance"],
    );
  }
}
