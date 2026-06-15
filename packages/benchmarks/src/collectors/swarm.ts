import type { ParallelSwarmResult, AgentContribution } from "@arelyos/engine/llm/swarm-task-types.js";
import type { Collector, BenchmarkMetric } from "../types.js";

export function createSwarmCollector(
  results: ParallelSwarmResult[],
): Collector {
  return {
    name: "swarm",
    description: "Swarm orchestration metrics: latency distribution, shared memory overhead, task graph complexity",
    collect() {
      const metrics: BenchmarkMetric[] = [];

      if (results.length === 0) {
        return {
          name: "swarm",
          description: "Swarm orchestration metrics",
          metrics: [{ name: "swarm_runs", value: 0, unit: "count" }],
        };
      }

      metrics.push({ name: "swarm_runs", value: results.length, unit: "count" });

      let totalTasks = 0;
      let totalPhases = 0;
      let totalContributions = 0;
      const allOutputKeys = new Set<string>();

      for (const r of results) {
        totalTasks += r.tasks.length;
        totalContributions += r.contributions.length;

        for (const key of Object.keys(r.outputs)) {
          allOutputKeys.add(key);
        }
      }

      const avgTasksPerRun = results.length > 0 ? totalTasks / results.length : 0;
      metrics.push({ name: "avg_tasks_per_run", value: Math.round(avgTasksPerRun * 10) / 10, unit: "count" });

      const roleCounts = new Map<string, number>();
      for (const r of results) {
        for (const c of r.contributions) {
          const key = c.role;
          roleCounts.set(key, (roleCounts.get(key) ?? 0) + 1);
        }
      }
      for (const [role, count] of roleCounts) {
        metrics.push({ name: `contributions_by_role__${role}`, value: count, unit: "count" });
      }

      const avgContributionsPerRun = results.length > 0
        ? Math.round((totalContributions / results.length) * 10) / 10
        : 0;
      metrics.push({ name: "avg_contributions_per_run", value: avgContributionsPerRun, unit: "count" });

      const runsWithReview = results.filter((r) => r.review.length > 0).length;
      const reviewRate = results.length > 0 ? runsWithReview / results.length : 0;
      metrics.push({ name: "review_rate", value: round3(reviewRate), unit: "ratio" });

      const runsWithSynthesis = results.filter((r) => r.synthesis.length > 0).length;
      const synthesisRate = results.length > 0 ? runsWithSynthesis / results.length : 0;
      metrics.push({ name: "synthesis_rate", value: round3(synthesisRate), unit: "ratio" });

      return {
        name: "swarm",
        description: "Swarm orchestration metrics",
        metrics,
      };
    },
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
