import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb } from "./database.js";
import { plans, planSteps } from "./schema.js";
import type { PlanRecord, PlanStepRecord, PlanStatus, PlanStepStatus } from "../types.js";

const TERMINAL_STEP_STATUSES = new Set<PlanStepStatus>(["completed", "failed", "blocked", "skipped"]);

function isTerminal(status: PlanStepStatus): boolean {
  return TERMINAL_STEP_STATUSES.has(status);
}

export function createPlan(data: {
  id?: string;
  sessionId: string;
  goal: string;
  agentId?: string;
}): PlanRecord {
  const id = data.id ?? ulid();
  const now = new Date().toISOString();
  const row = {
    id,
    sessionId: data.sessionId,
    agentId: data.agentId ?? null,
    goal: data.goal,
    status: "pending" as PlanStatus,
    createdAt: now,
    completedAt: null,
  };
  getDb().insert(plans).values(row).run();
  return row;
}

export function getPlan(id: string): PlanRecord | undefined {
  return getDb().select().from(plans).where(eq(plans.id, id)).get() as PlanRecord | undefined;
}

export function updatePlanStatus(id: string, status: PlanStatus): void {
  const current = getPlan(id);
  if (!current) return;

  const now = new Date().toISOString();
  const isCurrentlyTerminal =
    current.status === "completed" || current.status === "failed";
  const isNewTerminal = status === "completed" || status === "failed";

  const updates: Record<string, unknown> = {
    status,
    completedAt:
      !isCurrentlyTerminal && isNewTerminal ? now : undefined,
  };

  getDb().update(plans).set(updates).where(eq(plans.id, id)).run();
}

export function listPlansBySession(sessionId: string): PlanRecord[] {
  return getDb()
    .select()
    .from(plans)
    .where(eq(plans.sessionId, sessionId))
    .orderBy(plans.createdAt)
    .all() as PlanRecord[];
}

export function createSteps(
  steps: {
    id?: string;
    planId: string;
    description: string;
    tool?: string | null;
    args?: string | null;
    dependsOn: string;
    order: number;
  }[],
): PlanStepRecord[] {
  const now = new Date().toISOString();
  const rows: PlanStepRecord[] = steps.map((s) => ({
    id: s.id ?? ulid(),
    planId: s.planId,
    description: s.description,
    tool: s.tool ?? null,
    args: s.args ?? null,
    dependsOn: s.dependsOn,
    status: "pending",
    result: null,
    error: null,
    order: s.order,
    createdAt: now,
    completedAt: null,
  }));

  const db = getDb();
  for (const row of rows) {
    db.insert(planSteps).values(row).run();
  }

  return rows;
}

export function updatePlanAgentId(id: string, agentId: string): void {
  getDb().update(plans).set({ agentId }).where(eq(plans.id, id)).run();
}

export function listPlansByAgent(agentId: string): PlanRecord[] {
  return getDb()
    .select()
    .from(plans)
    .where(eq(plans.agentId, agentId))
    .orderBy(plans.createdAt)
    .all() as PlanRecord[];
}

export function listPlansByStatus(status: PlanStatus): PlanRecord[] {
  return getDb().select().from(plans).where(eq(plans.status, status)).all() as PlanRecord[];
}

export function markStepPending(id: string): void {
  const current = getStep(id);
  if (current?.status !== "running") return;
  getDb().update(planSteps).set({ status: "pending" }).where(eq(planSteps.id, id)).run();
}

export function getStepsByPlan(planId: string): PlanStepRecord[] {
  return getDb()
    .select()
    .from(planSteps)
    .where(eq(planSteps.planId, planId))
    .orderBy(planSteps.order)
    .all() as PlanStepRecord[];
}

export function markStepRunning(id: string): void {
  const current = getStep(id);
  if (!current || isTerminal(current.status)) return;
  getDb().update(planSteps).set({ status: "running" }).where(eq(planSteps.id, id)).run();
}

export function markStepCompleted(id: string, result: string): void {
  const current = getStep(id);
  if (!current || isTerminal(current.status)) return;
  const now = new Date().toISOString();
  getDb()
    .update(planSteps)
    .set({ status: "completed", result, completedAt: now })
    .where(eq(planSteps.id, id))
    .run();
}

export function markStepFailed(id: string, error: string): void {
  const current = getStep(id);
  if (!current || isTerminal(current.status)) return;
  const now = new Date().toISOString();
  getDb()
    .update(planSteps)
    .set({ status: "failed", error, completedAt: now })
    .where(eq(planSteps.id, id))
    .run();
}

export function markStepBlocked(id: string): void {
  const current = getStep(id);
  if (!current || isTerminal(current.status)) return;
  const now = new Date().toISOString();
  getDb()
    .update(planSteps)
    .set({ status: "blocked", completedAt: now })
    .where(eq(planSteps.id, id))
    .run();
}

export function markStepSkipped(id: string): void {
  const current = getStep(id);
  if (!current || isTerminal(current.status)) return;
  const now = new Date().toISOString();
  getDb()
    .update(planSteps)
    .set({ status: "skipped", completedAt: now })
    .where(eq(planSteps.id, id))
    .run();
}

function getStep(id: string): PlanStepRecord | undefined {
  return getDb().select().from(planSteps).where(eq(planSteps.id, id)).get() as
    | PlanStepRecord
    | undefined;
}
