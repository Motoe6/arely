import { queryDecisions, searchMemories } from "@arelyos/persistence";
import { memoryService } from "./memory-service.js";

export interface DecisionStats {
  type: string;
  total: number;
  successes: number;
  failures: number;
  pending: number;
  successRate: number;
}

export class MetaReasoner {
  async buildDecisionStats(sessionId: string): Promise<DecisionStats[]> {
    const all = queryDecisions({ sessionId, limit: 500 });
    const grouped = new Map<string, { total: number; successes: number; failures: number; pending: number }>();

    for (const d of all) {
      let g = grouped.get(d.decisionType);
      if (!g) {
        g = { total: 0, successes: 0, failures: 0, pending: 0 };
        grouped.set(d.decisionType, g);
      }
      g.total++;
      if (d.outcome === "success") g.successes++;
      else if (d.outcome === "failure") g.failures++;
      else g.pending++;
    }

    const result: DecisionStats[] = [];
    for (const [type, g] of grouped) {
      result.push({
        type,
        total: g.total,
        successes: g.successes,
        failures: g.failures,
        pending: g.pending,
        successRate: g.total > 0 ? Math.round((g.successes / g.total) * 100) : 0,
      });
    }

    return result.sort((a, b) => b.total - a.total);
  }

  async buildMetaContextString(sessionId: string): Promise<string> {
    const parts: string[] = [];

    const stats = await this.buildDecisionStats(sessionId);
    if (stats.length > 0) {
      const lines = stats.map(
        (s) => `  ${s.type}: ${s.successes}/${s.total} successful (${s.successRate}%)`,
      );
      parts.push(`[Decision History]\n${lines.join("\n")}`);
    }

    const patterns = await searchMemories(sessionId, {
      limit: 20,
    });

    const learned = patterns.filter(
      (m) => m.tags.includes("auto-learned") || m.tags.includes("correlated"),
    );
    if (learned.length > 0) {
      const lines = learned.map(
        (m) => `  [${m.type}] ${m.key}: ${m.value} (confidence: ${m.confidence}%)`,
      );
      parts.push(`[Learned Patterns]\n${lines.join("\n")}`);
    }

    const attention = patterns.filter((m) => m.tags.includes("needs-attention"));
    if (attention.length > 0) {
      const lines = attention.map((m) => `  ${m.key}: ${m.value}`);
      parts.push(`[Areas Needing Attention]\n${lines.join("\n")}`);
    }

    const strategyPerf = patterns.filter((m) => m.tags.includes("strategy-performance"));
    if (strategyPerf.length > 0) {
      const lines = strategyPerf.map((m) => `  ${m.key}: ${m.value}`);
      parts.push(`[Strategy Performance History]\n${lines.join("\n")}`);
    }

    return parts.join("\n\n");
  }

  async reflectOnSession(sessionId: string): Promise<void> {
    const stats = await this.buildDecisionStats(sessionId);
    if (stats.length === 0) return;

    const total = stats.reduce((s, g) => s + g.total, 0);
    const successes = stats.reduce((s, g) => s + g.successes, 0);
    const overallRate = total > 0 ? Math.round((successes / total) * 100) : 0;

    const best = stats.reduce((a, b) => (a.successRate > b.successRate ? a : b), stats[0]);
    const worst = stats.reduce((a, b) => (a.successRate < b.successRate ? a : b), stats[0]);

    const summary = `Session completed: ${successes}/${total} decisions successful (${overallRate}%). ` +
      `Best area: ${best.type} (${best.successRate}%). ` +
      (worst.successRate < 100 ? `Needs improvement: ${worst.type} (${worst.successRate}%).` : "");

    await memoryService.setMemory(
      sessionId,
      "conversation_summary",
      `session_reflection_${sessionId.slice(0, 8)}`,
      summary,
      Math.min(95, overallRate),
      "derived",
      ["auto-learned", "meta-reflection", "session-summary"],
    );
  }
}
