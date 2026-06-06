import {
  listPlansByStatus,
  getPlan,
  getStepsByPlan,
  updatePlanStatus,
  markStepPending,
} from "../persistence/plan-store.js";
import type { PlanRecord } from "../types.js";
import type { WorkflowExecutor, WorkflowResult } from "./workflow.js";

export function recoverPlans(): PlanRecord[] {
  const plans = listPlansByStatus("executing");
  for (const plan of plans) {
    const steps = getStepsByPlan(plan.id);
    for (const step of steps) {
      if (step.status === "running") {
        markStepPending(step.id);
      }
    }
  }
  return plans;
}

export async function resumePlan(
  planId: string,
  executor: WorkflowExecutor,
  signal?: AbortSignal,
): Promise<WorkflowResult> {
  const plan = getPlan(planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);

  const steps = getStepsByPlan(planId);
  for (const step of steps) {
    if (step.status === "running") {
      markStepPending(step.id);
      step.status = "pending";
    }
  }

  updatePlanStatus(planId, "executing");
  return executor.execute({ ...plan, steps }, signal);
}
