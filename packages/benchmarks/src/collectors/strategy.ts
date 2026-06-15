import type { DecisionRecord } from "@arely/persistence";
import type { Collector, BenchmarkMetric } from "../types.js";

export function createStrategyCollector(
  decisions: DecisionRecord[],
): Collector {
  return {
    name: "strategy",
    description: "Strategy performance and convergence metrics from decision records",
    collect() {
      const metrics: BenchmarkMetric[] = [];

      const strategyGroups = new Map<string, { successes: number; total: number }>();
      for (const d of decisions) {
        const s = d.metadata?.strategy;
        if (typeof s !== "string") continue;
        let g = strategyGroups.get(s);
        if (!g) { g = { successes: 0, total: 0 }; strategyGroups.set(s, g); }
        g.total++;
        if (d.outcome === "success") g.successes++;
      }

      if (strategyGroups.size === 0) {
        return {
          name: "strategy",
          description: "Strategy performance metrics",
          metrics: [{ name: "strategies_tracked", value: 0, unit: "count" }],
        };
      }

      metrics.push({ name: "strategies_tracked", value: strategyGroups.size, unit: "count" });

      let totalSuccesses = 0;
      let totalAttempts = 0;

      for (const [strategy, g] of strategyGroups) {
        const rate = g.total > 0 ? g.successes / g.total : 0;
        totalSuccesses += g.successes;
        totalAttempts += g.total;

        metrics.push(
          { name: `strategy_success_rate__${strategy}`, value: round3(rate), unit: "ratio", threshold: { operator: "gte", value: 0.60 }, passed: rate >= 0.60 },
          { name: `strategy_attempts__${strategy}`, value: g.total, unit: "count" },
        );
      }

      const overallRate = totalAttempts > 0 ? totalSuccesses / totalAttempts : 0;
      metrics.push(
        { name: "overall_success_rate", value: round3(overallRate), unit: "ratio", threshold: { operator: "gte", value: 0.60 }, passed: overallRate >= 0.60 },
        { name: "total_attempts", value: totalAttempts, unit: "count" },
        { name: "total_successes", value: totalSuccesses, unit: "count" },
      );

      return {
        name: "strategy",
        description: "Strategy performance metrics from decision records",
        metrics,
      };
    },
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
