import { eq, desc, and, type SQL } from "drizzle-orm"
import { ulid } from "ulid"
import { getDb } from "./database.js"
import { workflowRuns, workflowStepRuns } from "./schema.js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any

export interface WorkflowRunRecord {
  id: string
  workflowId: string
  workflowVersion: number
  status: "running" | "completed" | "failed"
  triggerInput: string | null
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  error: string | null
}

export interface WorkflowStepRunRecord {
  id: string
  runId: string
  stepId: string
  stepType: string
  status: "running" | "completed" | "failed"
  input: string | null
  output: string | null
  error: string | null
  startedAt: string
  completedAt: string | null
  durationMs: number | null
}

export interface RunWithSteps {
  run: WorkflowRunRecord
  steps: WorkflowStepRunRecord[]
}

function resolveDb(db?: DbClient): DbClient {
  return db ?? getDb()
}

export function createRun(
  workflowId: string,
  workflowVersion: number,
  triggerInput?: Record<string, unknown>,
  db?: DbClient,
  replayOfRunId?: string,
  replayFromStepId?: string,
): WorkflowRunRecord {
  const d = resolveDb(db)
  const id = ulid()
  const now = new Date().toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: any = {
    id,
    workflowId,
    workflowVersion,
    status: "running",
    triggerInput: triggerInput ? JSON.stringify(triggerInput) : null,
    startedAt: now,
    completedAt: null,
    durationMs: null,
    error: null,
  }
  if (replayOfRunId) row.replayOfRunId = replayOfRunId
  if (replayFromStepId) row.replayFromStepId = replayFromStepId
  d.insert(workflowRuns).values(row).run()
  return {
    id, workflowId, workflowVersion, status: "running" as const,
    triggerInput: triggerInput ? JSON.stringify(triggerInput) : null,
    startedAt: now, completedAt: null, durationMs: null, error: null,
  }
}

export function getRun(id: string, db?: DbClient): WorkflowRunRecord | undefined {
  const d = resolveDb(db)
  return d.select().from(workflowRuns).where(eq(workflowRuns.id, id)).get() as
    | WorkflowRunRecord
    | undefined
}

export function listRuns(
  opts?: { workflowId?: string; status?: string; limit?: number },
  db?: DbClient,
): WorkflowRunRecord[] {
  const d = resolveDb(db)
  const conditions: SQL[] = []
  if (opts?.workflowId) conditions.push(eq(workflowRuns.workflowId, opts.workflowId))
  if (opts?.status) conditions.push(eq(workflowRuns.status, opts.status))

  let query = d.select().from(workflowRuns).orderBy(desc(workflowRuns.startedAt))
  if (conditions.length > 0) query = query.where(and(...conditions))
  if (opts?.limit) query = query.limit(opts.limit)

  return query.all() as WorkflowRunRecord[]
}

export function completeRun(
  id: string,
  status: "completed" | "failed",
  error?: string,
  db?: DbClient,
): void {
  const d = resolveDb(db)
  const run = getRun(id, db)
  if (!run) return
  const now = new Date().toISOString()
  const started = new Date(run.startedAt).getTime()
  const durationMs = now ? Date.now() - started : null
  d.update(workflowRuns)
    .set({ status, completedAt: now, durationMs, error: error ?? null })
    .where(eq(workflowRuns.id, id))
    .run()
}

export function createStepRun(
  runId: string,
  stepId: string,
  stepType: string,
  input?: Record<string, unknown>,
  db?: DbClient,
  copiedFromStepRunId?: string,
): WorkflowStepRunRecord {
  const d = resolveDb(db)
  const id = ulid()
  const now = new Date().toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: any = {
    id,
    runId,
    stepId,
    stepType,
    status: "running",
    input: input ? JSON.stringify(input) : null,
    output: null,
    error: null,
    startedAt: now,
    completedAt: null,
    durationMs: null,
  }
  if (copiedFromStepRunId) row.copiedFromStepRunId = copiedFromStepRunId
  d.insert(workflowStepRuns).values(row).run()
  return {
    id, runId, stepId, stepType, status: "running" as const,
    input: input ? JSON.stringify(input) : null, output: null, error: null,
    startedAt: now, completedAt: null, durationMs: null,
  }
}

export function completeStepRun(
  id: string,
  status: "completed" | "failed",
  output?: string,
  error?: string,
  db?: DbClient,
): void {
  const d = resolveDb(db)
  const stepRun = d
    .select()
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.id, id))
    .get() as WorkflowStepRunRecord | undefined
  if (!stepRun) return
  const now = new Date().toISOString()
  const started = new Date(stepRun.startedAt).getTime()
  const durationMs = Date.now() - started
  d.update(workflowStepRuns)
    .set({ status, completedAt: now, durationMs, output: output ?? null, error: error ?? null })
    .where(eq(workflowStepRuns.id, id))
    .run()
}

export function getRunSteps(runId: string, db?: DbClient): WorkflowStepRunRecord[] {
  const d = resolveDb(db)
  return d
    .select()
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.runId, runId))
    .orderBy(desc(workflowStepRuns.startedAt))
    .all() as WorkflowStepRunRecord[]
}

export function getRunWithSteps(runId: string, db?: DbClient): RunWithSteps | undefined {
  const run = getRun(runId, db)
  if (!run) return undefined
  const steps = getRunSteps(runId, db)
  return { run, steps }
}
