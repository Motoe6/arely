import type { StoredGoal } from "@arelyos/ui-core/types/index.js";

export async function getGoals(): Promise<StoredGoal[]> {
  try {
    const { goalService } = await import("@arelyos/engine/llm/goal-service.js");
    const goals = goalService.getActiveGoals();
    return goals.map((g: { id: string; title: string; progressPct: number; status: string }) => ({
      id: g.id,
      title: g.title,
      progressPct: g.progressPct,
      status: g.status as StoredGoal["status"],
    }));
  } catch {
    return [];
  }
}
