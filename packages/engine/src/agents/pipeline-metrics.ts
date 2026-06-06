/**
 * F19 Reliability Metrics
 *
 * All metrics are computed from persisted pipeline_run and pipeline_step_run data.
 * Replay runs (replayOf != null) are excluded from all calculations.
 * No derived state or caching — every call queries fresh data.
 */

import { eq, and, isNull, sql } from "drizzle-orm";
import { getDb } from "../persistence/database.js";
import { pipelineStepRuns, pipelineRuns, agentPipelines } from "../persistence/schema.js";

export interface OverviewMetrics {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  totalStepRuns: number;
  avgRunDurationMs: number;
  p95RunDurationMs: number;
  avgStepsPerRun: number;
  toolsCount: number;
  pipelinesCount: number;
}

export interface ToolMetric {
  toolName: string;
  total: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  cancelledCount: number;
  successRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  avgRetries: number;
  lastSeenAt: string | null;
}

export interface PipelineMetric {
  pipelineId: string;
  pipelineName: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  avgRunDurationMs: number;
  p95RunDurationMs: number;
  avgStepsPerRun: number;
}

export interface ErrorMetric {
  errorKind: string;
  count: number;
  percentage: number;
}

function durationMs(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) return null;
  return new Date(finishedAt).getTime() - new Date(startedAt).getTime();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

interface ToolRow {
  runId: string;
  stepId: string;
  toolName: string | null;
  status: string | null;
  errorKind: string | null;
  retryCount: number;
  startedAt: string | null;
  finishedAt: string | null;
}

export function getOverviewMetrics(): OverviewMetrics {
  const db = getDb();
  const runs = db.select().from(pipelineRuns).where(isNull(pipelineRuns.replayOf)).all();
  const totalRuns = runs.length;
  const completedRuns = runs.filter((r) => r.status === "completed").length;
  const failedRuns = runs.filter((r) => r.status === "failed").length;

  const stepCountRow = db
    .select({ count: sql<number>`count(*)` })
    .from(pipelineStepRuns)
    .innerJoin(pipelineRuns, eq(pipelineStepRuns.runId, pipelineRuns.id))
    .where(isNull(pipelineRuns.replayOf))
    .all();
  const totalStepRuns = stepCountRow[0]?.count ?? 0;

  const allDurations: number[] = [];
  let totalSteps = 0;
  for (const run of runs) {
    const d = durationMs(run.startedAt, run.completedAt);
    if (d !== null) allDurations.push(d);
    totalSteps += run.stepsTotal;
  }
  const avgRunDurationMs = allDurations.length > 0
    ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length
    : 0;
  const p95RunDurationMs = percentile(allDurations.sort((a, b) => a - b), 0.95);

  const pipelineCountRow = db.select({ count: sql<number>`count(*)` }).from(agentPipelines).all();
  const pipelinesCount = pipelineCountRow[0]?.count ?? 0;

  const toolCountRow = db
    .select({ count: sql<number>`count(distinct ${pipelineStepRuns.toolName})` })
    .from(pipelineStepRuns)
    .innerJoin(pipelineRuns, eq(pipelineStepRuns.runId, pipelineRuns.id))
    .where(and(isNull(pipelineRuns.replayOf), eq(pipelineStepRuns.stepType, "tool")))
    .all();
  const toolsCount = toolCountRow[0]?.count ?? 0;

  const avgStepsPerRun = totalRuns > 0 ? totalSteps / totalRuns : 0;

  return {
    totalRuns,
    completedRuns,
    failedRuns,
    totalStepRuns,
    avgRunDurationMs: Math.round(avgRunDurationMs),
    p95RunDurationMs: Math.round(p95RunDurationMs),
    avgStepsPerRun: Math.round(avgStepsPerRun * 100) / 100,
    toolsCount,
    pipelinesCount,
  };
}

export function getToolMetrics(): ToolMetric[] {
  const db = getDb();
  const rows = db
    .select({
      runId: pipelineStepRuns.runId,
      stepId: pipelineStepRuns.stepId,
      toolName: pipelineStepRuns.toolName,
      status: pipelineStepRuns.status,
      errorKind: pipelineStepRuns.errorKind,
      retryCount: pipelineStepRuns.retryCount,
      startedAt: pipelineStepRuns.startedAt,
      finishedAt: pipelineStepRuns.finishedAt,
    })
    .from(pipelineStepRuns)
    .innerJoin(pipelineRuns, eq(pipelineStepRuns.runId, pipelineRuns.id))
    .where(and(eq(pipelineStepRuns.stepType, "tool"), isNull(pipelineRuns.replayOf)))
    .all() as ToolRow[];

  const groups = new Map<string, {
    total: number;
    successCount: number;
    failureCount: number;
    timeoutCount: number;
    cancelledCount: number;
    durations: number[];
    lastSeen: string | null;
  }>();

  for (const row of rows) {
    if (!row.toolName) continue;
    let acc = groups.get(row.toolName);
    if (!acc) {
      acc = { total: 0, successCount: 0, failureCount: 0, timeoutCount: 0, cancelledCount: 0, durations: [], lastSeen: null };
      groups.set(row.toolName, acc);
    }
    acc.total++;
    if (row.status === "completed") acc.successCount++;
    else if (row.status === "failed") {
      acc.failureCount++;
      if (row.errorKind === "timeout") acc.timeoutCount++;
      if (row.errorKind === "cancelled") acc.cancelledCount++;
    }
    const d = durationMs(row.startedAt, row.finishedAt);
    if (d !== null) acc.durations.push(d);
    if (row.finishedAt && (!acc.lastSeen || row.finishedAt > acc.lastSeen)) {
      acc.lastSeen = row.finishedAt;
    }
  }

  const result: ToolMetric[] = [];
  const toolRetryMap = new Map<string, Map<string, number>>();

  for (const row of rows) {
    if (!row.toolName) continue;
    if (!toolRetryMap.has(row.toolName)) toolRetryMap.set(row.toolName, new Map());
    const stepMap = toolRetryMap.get(row.toolName)!;
    const key = `${row.runId}::${row.stepId}`;
    stepMap.set(key, Math.max(stepMap.get(key) ?? 0, row.retryCount));
  }

  for (const [toolName, acc] of groups) {
    const sortedDurs = acc.durations.sort((a, b) => a - b);
    const avgD = sortedDurs.length > 0 ? sortedDurs.reduce((a, b) => a + b, 0) / sortedDurs.length : 0;
    const effectiveAttempts = acc.successCount + acc.failureCount;
    const stepMap = toolRetryMap.get(toolName);
    let avgRetries = 0;
    if (stepMap && stepMap.size > 0) {
      const values = [...stepMap.values()];
      avgRetries = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
    }
    result.push({
      toolName,
      total: acc.total,
      successCount: acc.successCount,
      failureCount: acc.failureCount,
      timeoutCount: acc.timeoutCount,
      cancelledCount: acc.cancelledCount,
      successRate: effectiveAttempts > 0 ? acc.successCount / effectiveAttempts : 0,
      avgDurationMs: Math.round(avgD),
      p95DurationMs: Math.round(percentile(sortedDurs, 0.95)),
      avgRetries,
      lastSeenAt: acc.lastSeen,
    });
  }

  result.sort((a, b) => b.total - a.total);
  return result;
}

export function getPipelineMetrics(): PipelineMetric[] {
  const db = getDb();
  const rows = db
    .select({
      pipelineId: pipelineRuns.pipelineId,
      name: agentPipelines.name,
      status: pipelineRuns.status,
      stepsTotal: pipelineRuns.stepsTotal,
      startedAt: pipelineRuns.startedAt,
      completedAt: pipelineRuns.completedAt,
    })
    .from(pipelineRuns)
    .innerJoin(agentPipelines, eq(pipelineRuns.pipelineId, agentPipelines.id))
    .where(isNull(pipelineRuns.replayOf))
    .all();

  const groups = new Map<string, {
    name: string;
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    durations: number[];
    totalSteps: number;
  }>();

  for (const row of rows) {
    let acc = groups.get(row.pipelineId);
    if (!acc) {
      acc = { name: row.name, totalRuns: 0, completedRuns: 0, failedRuns: 0, durations: [], totalSteps: 0 };
      groups.set(row.pipelineId, acc);
    }
    acc.totalRuns++;
    if (row.status === "completed") acc.completedRuns++;
    else if (row.status === "failed") acc.failedRuns++;
    const d = durationMs(row.startedAt, row.completedAt);
    if (d !== null) acc.durations.push(d);
    acc.totalSteps += row.stepsTotal;
  }

  const result: PipelineMetric[] = [];
  for (const [pipelineId, acc] of groups) {
    const sorted = acc.durations.sort((a, b) => a - b);
    const avgD = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
    result.push({
      pipelineId,
      pipelineName: acc.name,
      totalRuns: acc.totalRuns,
      completedRuns: acc.completedRuns,
      failedRuns: acc.failedRuns,
      avgRunDurationMs: Math.round(avgD),
      p95RunDurationMs: Math.round(percentile(sorted, 0.95)),
      avgStepsPerRun: acc.totalRuns > 0 ? Math.round((acc.totalSteps / acc.totalRuns) * 100) / 100 : 0,
    });
  }

  result.sort((a, b) => b.totalRuns - a.totalRuns);
  return result;
}

export function getErrorMetrics(): ErrorMetric[] {
  const db = getDb();
  const rows = db
    .select({ errorKind: pipelineStepRuns.errorKind })
    .from(pipelineStepRuns)
    .innerJoin(pipelineRuns, eq(pipelineStepRuns.runId, pipelineRuns.id))
    .where(and(eq(pipelineStepRuns.status, "failed"), isNull(pipelineRuns.replayOf)))
    .all();

  const counts = new Map<string, number>();
  let totalFailures = 0;
  for (const row of rows) {
    const kind = row.errorKind ?? "unknown";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    totalFailures++;
  }

  const result: ErrorMetric[] = [];
  for (const [errorKind, count] of counts) {
    result.push({
      errorKind,
      count,
      percentage: totalFailures > 0 ? Math.round((count / totalFailures) * 10000) / 100 : 0,
    });
  }
  result.sort((a, b) => b.count - a.count);
  return result;
}
