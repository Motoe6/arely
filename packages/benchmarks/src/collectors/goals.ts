import type { Goal } from "@arelyos/persistence";
import type { GoalPlan } from "@arelyos/persistence";
import type { Collector, BenchmarkMetric } from "../types.js";

export function createGoalsCollector(
  goals: Goal[],
  plans: GoalPlan[],
): Collector {
  return {
    name: "goals",
    description: "Goal persistence health metrics: completion rate, progress, and utility gain estimates",
    collect() {
      const metrics: BenchmarkMetric[] = [];

      if (goals.length === 0) {
        return {
          name: "goals",
          description: "Goal persistence health metrics",
          metrics: [{ name: "total_goals", value: 0, unit: "count" }],
        };
      }

      metrics.push({ name: "total_goals", value: goals.length, unit: "count" });

      const completed = goals.filter((g) => g.status === "completed").length;
      const active = goals.filter((g) => g.status === "active").length;
      const paused = goals.filter((g) => g.status === "paused").length;
      const abandoned = goals.filter((g) => g.status === "abandoned").length;
      const completionRate = goals.length > 0 ? completed / goals.length : 0;

      metrics.push(
        { name: "completed_goals", value: completed, unit: "count" },
        { name: "active_goals", value: active, unit: "count" },
        { name: "paused_goals", value: paused, unit: "count" },
        { name: "abandoned_goals", value: abandoned, unit: "count" },
        { name: "completion_rate", value: round3(completionRate), unit: "ratio", threshold: { operator: "gte", value: 0.50 }, passed: completionRate >= 0.50 },
      );

      const avgProgress = goals.length > 0
        ? goals.reduce((s, g) => s + g.progressPct, 0) / goals.length
        : 0;
      metrics.push({ name: "avg_progress_pct", value: Math.round(avgProgress * 10) / 10, unit: "percent" });

      if (plans.length > 0) {
        metrics.push({ name: "total_plans", value: plans.length, unit: "count" });
        const avgPlanProgress = plans.reduce((s, p) => s + p.progressPct, 0) / plans.length;
        metrics.push({ name: "avg_plan_progress_pct", value: Math.round(avgPlanProgress * 10) / 10, unit: "percent" });
        const completedPlans = plans.filter((p) => p.status === "completed").length;
        const planCompletionRate = plans.length > 0 ? completedPlans / plans.length : 0;
        metrics.push({ name: "plan_completion_rate", value: round3(planCompletionRate), unit: "ratio" });
      }

      const staleActive = goals.filter((g) => g.status === "active" && g.progressPct === 0).length;
      metrics.push({ name: "stalled_goals", value: staleActive, unit: "count", threshold: { operator: "lt", value: 3 }, passed: staleActive < 3 });

      return {
        name: "goals",
        description: "Goal persistence health metrics",
        metrics,
      };
    },
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
