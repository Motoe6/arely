import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb } from "../persistence/database.js";
import { agentPipelines, pipelineSteps, pipelineRuns, pipelineStepRuns } from "../persistence/schema.js";
import type { ExecutionErrorKind, RetryStrategy } from "./execution-contract.js";
import { VALID_ERROR_KINDS, VALID_RETRY_STRATEGIES } from "./execution-contract.js";

export interface PipelineRecord {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStepRecord {
  id: string;
  pipelineId: string;
  type: string;
  agentId: string | null;
  toolName: string | null;
  stepOrder: number;
  dependsOn: string;
  inputMapping: string | null;
  outputKey: string | null;
  timeoutMs: number | null;
  retries: number | null;
  retryDelayMs: number | null;
  retryStrategy: RetryStrategy | null;
  idempotent: boolean | null;
  retryableErrors: ExecutionErrorKind[] | null;
  createdAt: string;
}

export type PipelineStepInput = {
  pipelineId: string;
  stepOrder: number;
  dependsOn?: string;
  inputMapping?: string | null;
  outputKey?: string | null;
  timeoutMs?: number | null;
  retries?: number | null;
  retryDelayMs?: number | null;
  retryStrategy?: RetryStrategy | null;
  idempotent?: boolean | null;
  retryableErrors?: ExecutionErrorKind[] | null;
} & (
  | { type?: "agent"; agentId: string; toolName?: never }
  | { type: "tool"; toolName: string; agentId?: never }
);

export interface PipelineRunRecord {
  id: string;
  pipelineId: string;
  status: "pending" | "running" | "completed" | "failed";
  stepsTotal: number;
  stepsCompleted: number;
  replayOf: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export type PipelineRunStatus = "pending" | "running" | "completed" | "failed";

export interface PipelineStepRunRecord {
  id: string;
  runId: string;
  stepId: string;
  stepType: string;
  agentId: string | null;
  toolName: string | null;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  input: string | null;
  output: string | null;
  error: string | null;
  errorKind: string | null;
  toolInputHash: string | null;
  toolOutputHash: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  retryCount: number;
  log: string;
}

export function createPipeline(data: { name: string; description?: string }): PipelineRecord {
  const id = ulid();
  const now = new Date().toISOString();
  const row = { id, name: data.name, description: data.description ?? null, createdAt: now, updatedAt: now };
  getDb().insert(agentPipelines).values(row).run();
  return row;
}

export function getPipeline(id: string): PipelineRecord | undefined {
  return getDb().select().from(agentPipelines).where(eq(agentPipelines.id, id)).get();
}

export function listPipelines(): PipelineRecord[] {
  return getDb().select().from(agentPipelines).orderBy(agentPipelines.createdAt).all();
}

export function deletePipeline(id: string): boolean {
  const result = getDb().delete(agentPipelines).where(eq(agentPipelines.id, id)).run();
  return result.changes > 0;
}

export function createPipelineStep(data: PipelineStepInput): PipelineStepRecord {
  const type = data.type ?? "agent";
  if (type === "agent" && !data.agentId) throw new Error("agentId required for agent step");
  if (type === "tool" && !data.toolName) throw new Error("toolName required for tool step");

  if (data.timeoutMs != null && data.timeoutMs <= 0) throw new Error("timeoutMs must be > 0");
  if (data.retries != null && data.retries < 0) throw new Error("retries must be >= 0");
  if (data.retryDelayMs != null && data.retryDelayMs < 0) throw new Error("retryDelayMs must be >= 0");
  if (data.retryableErrors != null) {
    for (const kind of data.retryableErrors) {
      if (!VALID_ERROR_KINDS.includes(kind)) {
        throw new Error(`Invalid retryableError: ${kind}`);
      }
    }
  }
  if (data.retryStrategy != null && !VALID_RETRY_STRATEGIES.includes(data.retryStrategy)) {
    throw new Error(`Invalid retryStrategy: ${data.retryStrategy}`);
  }

  const id = ulid();
  const now = new Date().toISOString();
  const row = {
    id,
    pipelineId: data.pipelineId,
    type,
    agentId: null as string | null,
    toolName: null as string | null,
    stepOrder: data.stepOrder,
    dependsOn: data.dependsOn ?? "[]",
    inputMapping: data.inputMapping ?? null,
    outputKey: data.outputKey ?? null,
    timeoutMs: data.timeoutMs ?? null,
    retries: data.retries ?? null,
    retryDelayMs: data.retryDelayMs ?? null,
    retryStrategy: data.retryStrategy ?? null,
    idempotent: data.idempotent ?? null,
    retryableErrors: data.retryableErrors != null ? JSON.stringify(data.retryableErrors) : null,
    createdAt: now,
  };
  if (type === "agent") {
    row.agentId = data.agentId!;
  } else {
    row.toolName = data.toolName!;
  }
  getDb().insert(pipelineSteps).values(row).run();
  return deserializeStep(row) as PipelineStepRecord;
}

export function getPipelineSteps(pipelineId: string): PipelineStepRecord[] {
  const rows = getDb()
    .select()
    .from(pipelineSteps)
    .where(eq(pipelineSteps.pipelineId, pipelineId))
    .orderBy(pipelineSteps.stepOrder)
    .all();
  return rows.map(deserializeStep);
}

function deserializeStep(row: Record<string, unknown>): PipelineStepRecord {
  const raw = row as { retryableErrors: string | null; idempotent: number | null; [key: string]: unknown };
  return {
    ...row,
    idempotent: raw.idempotent != null ? Boolean(raw.idempotent) : null,
    retryableErrors: raw.retryableErrors
      ? (JSON.parse(raw.retryableErrors) as ExecutionErrorKind[])
      : null,
  } as unknown as PipelineStepRecord;
}

export function deletePipelineSteps(pipelineId: string): void {
  getDb().delete(pipelineSteps).where(eq(pipelineSteps.pipelineId, pipelineId)).run();
}

export function createPipelineRun(data: { pipelineId: string; stepsTotal?: number; replayOf?: string | null }): PipelineRunRecord {
  const id = ulid();
  const now = new Date().toISOString();
  const row = {
    id,
    pipelineId: data.pipelineId,
    status: "pending" as PipelineRunStatus,
    stepsTotal: data.stepsTotal ?? 0,
    stepsCompleted: 0,
    replayOf: data.replayOf ?? null,
    startedAt: now,
    completedAt: null,
    error: null,
  };
  getDb().insert(pipelineRuns).values(row).run();
  return row;
}

export function updatePipelineRunStatus(id: string, status: PipelineRunStatus, error?: string): void {
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { status };
  if (status === "running") updates.startedAt = now;
  if (status === "completed" || status === "failed") updates.completedAt = now;
  if (error !== undefined) updates.error = error;
  getDb().update(pipelineRuns).set(updates).where(eq(pipelineRuns.id, id)).run();
}

export function getPipelineRun(id: string): PipelineRunRecord | undefined {
  return getDb().select().from(pipelineRuns).where(eq(pipelineRuns.id, id)).get() as PipelineRunRecord | undefined;
}

export function incrementPipelineRunStepsCompleted(id: string): void {
  const run = getPipelineRun(id);
  if (!run) return;
  getDb().update(pipelineRuns).set({ stepsCompleted: run.stepsCompleted + 1 }).where(eq(pipelineRuns.id, id)).run();
}

export function getPipelineRuns(pipelineId: string): PipelineRunRecord[] {
  return getDb()
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.pipelineId, pipelineId))
    .orderBy(pipelineRuns.startedAt)
    .all() as PipelineRunRecord[];
}

export function createPipelineStepRun(data: {
  runId: string;
  stepId: string;
  stepType: string;
  agentId?: string | null;
  toolName?: string | null;
  input?: string;
  toolInputHash?: string;
  errorKind?: string;
  retryCount?: number;
}): PipelineStepRunRecord {
  const id = ulid();
  const now = new Date().toISOString();
  const row = {
    id,
    runId: data.runId,
    stepId: data.stepId,
    stepType: data.stepType,
    agentId: data.agentId ?? null,
    toolName: data.toolName ?? null,
    status: "running" as const,
    input: data.input ?? null,
    output: null,
    error: null,
    errorKind: data.errorKind ?? null,
    toolInputHash: data.toolInputHash ?? null,
    toolOutputHash: null,
    startedAt: now,
    finishedAt: null,
    retryCount: data.retryCount ?? 0,
    log: "[]",
  };
  getDb().insert(pipelineStepRuns).values(row as unknown as typeof pipelineStepRuns.$inferInsert).run();
  return row;
}

export function updatePipelineStepRunStatus(
  id: string,
  status: "completed" | "failed" | "skipped",
  meta?: { output?: string; error?: string; toolOutputHash?: string; errorKind?: string },
): void {
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { status, finishedAt: now };
  if (meta?.output !== undefined) updates.output = meta.output;
  if (meta?.error !== undefined) updates.error = meta.error;
  if (meta?.toolOutputHash !== undefined) updates.toolOutputHash = meta.toolOutputHash;
  if (meta?.errorKind !== undefined) updates.errorKind = meta.errorKind;
  getDb().update(pipelineStepRuns).set(updates).where(eq(pipelineStepRuns.id, id)).run();
}

export function appendPipelineStepRunLog(id: string, message: string): void {
  const existing = getDb().select().from(pipelineStepRuns).where(eq(pipelineStepRuns.id, id)).get() as { log: string } | undefined;
  if (!existing) return;
  const parsed: unknown = JSON.parse(existing.log);
  const entries = Array.isArray(parsed) ? parsed as { timestamp: string; message: string }[] : [];
  entries.push({ timestamp: new Date().toISOString(), message });
  getDb().update(pipelineStepRuns).set({ log: JSON.stringify(entries) }).where(eq(pipelineStepRuns.id, id)).run();
}

export function getPipelineStepRuns(runId: string): PipelineStepRunRecord[] {
  return getDb()
    .select()
    .from(pipelineStepRuns)
    .where(eq(pipelineStepRuns.runId, runId))
    .orderBy(pipelineStepRuns.startedAt)
    .all() as PipelineStepRunRecord[];
}

export function getPipelineStepRun(id: string): PipelineStepRunRecord | undefined {
  return getDb().select().from(pipelineStepRuns).where(eq(pipelineStepRuns.id, id)).get() as PipelineStepRunRecord | undefined;
}
