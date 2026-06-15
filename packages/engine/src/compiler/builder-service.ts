import { ulid } from "ulid"
import { compileFromPrompt } from "@arelyos/flow-ai-compiler"
import { globalNodeRegistry } from "@arelyos/flow-sdk"
import type { CompilerLLMAdapter, CompileResult } from "@arelyos/flow-ai-compiler"
import type { Workflow } from "@arelyos/flow-runtime"
import {
  createWorkflow,
  getWorkflow as getWorkflowRecord,
  listWorkflows as listWorkflowRecords,
  updateWorkflow as updateWorkflowRecord,
  deleteWorkflow as deleteWorkflowRecord,
  createWorkflowVersion,
  getWorkflowWithCurrentVersion,
  getWorkflowVersions,
  parseWorkflowDsl,
} from "../persistence/workflow-store.js"
import type { WorkflowVersionRecord } from "../persistence/workflow-store.js"
import {
  createRun,
  completeRun,
  createStepRun,
  completeStepRun,
  getRunWithSteps,
  listRuns as listRunRecords,
} from "../persistence/run-store.js"
import type { RunWithSteps } from "../persistence/run-store.js"
import { getDb } from "../persistence/database.js"
import { loadSecretsMap } from "./secrets-store.js"
import { auditLog, workflowRuns, workflowStepRuns, workflows } from "../persistence/schema.js"
import { sql, eq, desc } from "drizzle-orm"

const TRIGGER_PAYLOAD_RE = /\{\{\s*trigger\.payload\.([^}]+)\s*\}\}/g
const STEP_REF_RE = /\{\{\s*steps\.([a-zA-Z0-9_-]+)(?:\.[a-zA-Z0-9_-]+)*\s*\}\}/g

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any

export class BuilderService {
  private adapter: CompilerLLMAdapter
  private db: DbClient

  constructor(adapter: CompilerLLMAdapter, db?: DbClient) {
    this.adapter = adapter
    this.db = db
  }

  async compile(prompt: string): Promise<CompileWorkflowResult> {
    const result = await compileFromPrompt({
      prompt,
      adapter: this.adapter,
      registry: globalNodeRegistry,
    })

    if (result.success && result.workflow) {
      const wfRecord = createWorkflow(
        { id: result.workflow.id, name: result.workflow.name, description: result.workflow.description },
        this.db,
      )
      createWorkflowVersion(wfRecord.id, JSON.stringify(result.workflow), "active", this.db)
      result.workflow.id = wfRecord.id
    }

    return result
  }

  async execute(
    workflowId: string,
    triggerInput: Record<string, unknown> = {},
  ): Promise<ExecuteWorkflowResult> {
    const entry = getWorkflowWithCurrentVersion(workflowId, this.db)
    if (!entry || !entry.version) {
      return { success: false, runId: "", steps: [], error: `Workflow "${workflowId}" not found` }
    }

    const workflow = parseWorkflowDsl(entry.version)
    const runId = ulid()
    const stepResults: StepExecutionResult[] = []
    const stepOutputs: Record<string, unknown> = {}
    const resolvedSecrets = loadSecretsMap(this.db)

    const run = createRun(workflowId, entry.version.version, triggerInput, this.db)

    for (const step of workflow.steps) {
      const stepStartTime = Date.now()
      let stepRunId = ""

      let node
      try {
        node = globalNodeRegistry.get(step.type)
      } catch {
        stepRunId = createStepRun(run.id, step.id, step.type, undefined, this.db).id
        completeStepRun(stepRunId, "failed", undefined, `Unknown node type "${step.type}"`, this.db)
        stepResults.push({ stepId: step.id, status: "failed", error: `Unknown node type "${step.type}"` })
        writeAudit(this.db, "workflow-run", "step_failed", `Step ${step.id}: unknown type "${step.type}"`, { workflowId, runId: run.id, stepId: step.id })
        continue
      }

      const input = resolveInput(step.input, stepOutputs, triggerInput)
      stepRunId = createStepRun(run.id, step.id, step.type, input, this.db).id

      try {
        const output = await node.execute(
          {
            workflowId: workflow.id,
            executionId: run.id,
            trigger: triggerInput,
            steps: stepOutputs,
            secrets: resolvedSecrets,
          },
          input,
        )

        const outputStr = String(typeof output === "string" ? output : JSON.stringify(output))
        stepOutputs[step.id] = output
        completeStepRun(stepRunId, "completed", outputStr, undefined, this.db)
        stepResults.push({ stepId: step.id, status: "completed", output: outputStr })
        writeAudit(this.db, "workflow-run", "step_completed", `Step ${step.id} completed`, { workflowId, runId: run.id, stepId: step.id, durationMs: Date.now() - stepStartTime })
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        completeStepRun(stepRunId, "failed", undefined, error, this.db)
        stepResults.push({ stepId: step.id, status: "failed", error })
        writeAudit(this.db, "workflow-run", "step_failed", `Step ${step.id}: ${error}`, { workflowId, runId: run.id, stepId: step.id, durationMs: Date.now() - stepStartTime })
      }
    }

    const allOk = stepResults.every((s) => s.status === "completed")
    const finalStatus = allOk ? "completed" : "failed"
    completeRun(run.id, finalStatus, allOk ? undefined : "One or more steps failed", this.db)
    writeAudit(this.db, "workflow-run", allOk ? "run_completed" : "run_failed", `Run ${finalStatus} for workflow ${workflowId}`, { workflowId, runId: run.id, steps: stepResults.length, failed: stepResults.filter((s) => s.status === "failed").length })

    return { success: allOk, runId: run.id, steps: stepResults, outputs: stepOutputs }
  }

  getWorkflow(id: string): Workflow | undefined {
    const entry = getWorkflowWithCurrentVersion(id, this.db)
    if (!entry || !entry.version) return undefined
    return parseWorkflowDsl(entry.version)
  }

  listWorkflows(): { id: string; description?: string; version: number }[] {
    const records = listWorkflowRecords(this.db)
    return records.map((r) => {
      let version = 0
      if (r.currentVersionId) {
        const entry = getWorkflowWithCurrentVersion(r.id, this.db)
        if (entry?.version) version = entry.version.version
      }
      return { id: r.id, description: r.description ?? undefined, version }
    })
  }

  listRuns(opts?: { workflowId?: string; status?: string; limit?: number }): RunWithSteps[] {
    const records = listRunRecords(opts, this.db)
    return records.map((r) => {
      const full = getRunWithSteps(r.id, this.db)
      return full ?? { run: r, steps: [] }
    })
  }

  getRun(id: string): RunWithSteps | undefined {
    return getRunWithSteps(id, this.db)
  }

  updateWorkflow(id: string, updates: { name?: string; description?: string }): void {
    updateWorkflowRecord(id, updates, this.db)
  }

  deleteWorkflow(id: string): void {
    deleteWorkflowRecord(id, this.db)
  }

  listWorkflowVersions(workflowId: string): WorkflowVersionRecord[] {
    return getWorkflowVersions(workflowId, this.db)
  }

  getMetricsSummary(): MetricsSummary {
    const d = this.db ?? getDb()

    const runStats = d
      .select({
        totalRuns: sql<number>`COUNT(*)`,
        completedRuns: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
        failedRuns: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
        runningRuns: sql<number>`SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END)`,
        avgDurationMs: sql<number>`AVG(duration_ms)`,
        totalDurationMs: sql<number>`SUM(duration_ms)`,
        firstRun: sql<string>`MIN(started_at)`,
        lastRun: sql<string>`MAX(started_at)`,
      })
      .from(workflowRuns)
      .get() as RunStatsRow | undefined

    const wfCount = (d.select({ count: sql<number>`COUNT(*)` }).from(workflows).get() as { count: number } | undefined)?.count ?? 0

    const totalRuns = runStats?.totalRuns ?? 0
    const completedRuns = runStats?.completedRuns ?? 0
    const failedRuns = runStats?.failedRuns ?? 0
    const runningRuns = runStats?.runningRuns ?? 0
    const avgDurationMs = Math.round(runStats?.avgDurationMs ?? 0)
    const totalDurationMs = runStats?.totalDurationMs ?? null
    const firstRun = runStats?.firstRun ?? null
    const lastRun = runStats?.lastRun ?? null

    let runsPerDay = 0
    if (firstRun && lastRun) {
      const days = (new Date(lastRun).getTime() - new Date(firstRun).getTime()) / 86400000
      runsPerDay = days > 0 ? Math.round((totalRuns / days) * 10) / 10 : totalRuns
    }

    const topNodes = d
      .select({
        stepType: workflowStepRuns.stepType,
        count: sql<number>`COUNT(*)`,
        avgDurationMs: sql<number>`AVG(duration_ms)`,
        failCount: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
      })
      .from(workflowStepRuns)
      .groupBy(workflowStepRuns.stepType)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(10)
      .all() as NodeStatsRow[]

    const slowestNodes = d
      .select({
        stepType: workflowStepRuns.stepType,
        avgDurationMs: sql<number>`AVG(duration_ms)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(workflowStepRuns)
      .groupBy(workflowStepRuns.stepType)
      .orderBy(desc(sql`AVG(duration_ms)`))
      .limit(10)
      .all() as SlowNodeRow[]

    return {
      totalRuns,
      completedRuns,
      failedRuns,
      runningRuns,
      successRate: totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0,
      failureRate: totalRuns > 0 ? Math.round((failedRuns / totalRuns) * 100) : 0,
      avgDurationMs,
      totalDurationMs,
      firstRun,
      lastRun,
      totalWorkflows: wfCount,
      runsPerDay,
      topNodes,
      slowestNodes,
    }
  }

  getWorkflowMetrics(workflowId: string): WorkflowMetricsData | null {
    const d = this.db ?? getDb()

    const wf = getWorkflowRecord(workflowId, this.db)
    if (!wf) return null

    const runStats = d
      .select({
        totalRuns: sql<number>`COUNT(*)`,
        completedRuns: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
        failedRuns: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
        runningRuns: sql<number>`SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END)`,
        avgDurationMs: sql<number>`AVG(duration_ms)`,
        lastRun: sql<string>`MAX(started_at)`,
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, workflowId))
      .get() as WfRunStatsRow | undefined

    const totalRuns = runStats?.totalRuns ?? 0
    const completedRuns = runStats?.completedRuns ?? 0
    const failedRuns = runStats?.failedRuns ?? 0

    const slowestSteps = d
      .select({
        stepType: workflowStepRuns.stepType,
        avgDurationMs: sql<number>`AVG(${workflowStepRuns.durationMs})`,
        count: sql<number>`COUNT(*)`,
      })
      .from(workflowStepRuns)
      .innerJoin(workflowRuns, eq(workflowStepRuns.runId, workflowRuns.id))
      .where(eq(workflowRuns.workflowId, workflowId))
      .groupBy(workflowStepRuns.stepType)
      .orderBy(desc(sql`AVG(${workflowStepRuns.durationMs})`))
      .limit(10)
      .all() as SlowNodeRow[]

    const mostFailedSteps = d
      .select({
        stepType: workflowStepRuns.stepType,
        failCount: sql<number>`SUM(CASE WHEN ${workflowStepRuns.status} = 'failed' THEN 1 ELSE 0 END)`,
        totalCount: sql<number>`COUNT(*)`,
      })
      .from(workflowStepRuns)
      .innerJoin(workflowRuns, eq(workflowStepRuns.runId, workflowRuns.id))
      .where(eq(workflowRuns.workflowId, workflowId))
      .groupBy(workflowStepRuns.stepType)
      .orderBy(desc(sql`SUM(CASE WHEN ${workflowStepRuns.status} = 'failed' THEN 1 ELSE 0 END)`))
      .limit(10)
      .all() as FailNodeRow[]

    const versions = getWorkflowVersions(workflowId, this.db)

    return {
      workflowId,
      totalRuns,
      completedRuns,
      failedRuns,
      runningRuns: runStats?.runningRuns ?? 0,
      successRate: totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0,
      avgDurationMs: Math.round(runStats?.avgDurationMs ?? 0),
      lastRun: runStats?.lastRun ?? null,
      totalVersions: versions.length,
      slowestSteps,
      mostFailedSteps: mostFailedSteps.map((s) => ({
        ...s,
        failureRate: s.totalCount > 0 ? Math.round((s.failCount / s.totalCount) * 100) : 0,
      })),
    }
  }
}

function writeAudit(
  db: unknown,
  category: string,
  action: string,
  detail: string,
  metadata?: Record<string, unknown>,
): void {
  try {
    const d = getDb()
    const payload = metadata ? { detail, ...metadata } : { detail }
    d.insert(auditLog).values({
      id: ulid(),
      category,
      action,
      actor: "builder-service",
      target: metadata?.workflowId as string | undefined,
      detail: JSON.stringify(payload),
    }).run()
  } catch {
    // audit is non-critical
  }
}

function resolveInput(
  input: Record<string, unknown> | undefined,
  stepOutputs: Record<string, unknown>,
  triggerInput: Record<string, unknown>,
): Record<string, unknown> {
  if (!input) return {}

  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      resolved[key] = resolveString(value, stepOutputs, triggerInput)
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      resolved[key] = resolveInput(value as Record<string, unknown>, stepOutputs, triggerInput)
    } else {
      resolved[key] = value
    }
  }
  return resolved
}

function resolveString(
  template: string,
  stepOutputs: Record<string, unknown>,
  triggerInput: Record<string, unknown>,
): string {
  const withSteps = template.replace(STEP_REF_RE, (_, stepId: string) => {
    const output = stepOutputs[stepId]
    if (output === undefined) return `{{steps.${stepId}}}`
    return typeof output === "string" ? output : JSON.stringify(output)
  })

  return withSteps.replace(TRIGGER_PAYLOAD_RE, (_, path: string) => {
    const value = deepGet(triggerInput, path.trim())
    if (value === undefined) return `{{trigger.payload.${path}}}`
    return typeof value === "string" ? value : JSON.stringify(value)
  })
}

function deepGet(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj
  for (const key of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export interface CompileWorkflowResult extends CompileResult {}

export interface MetricsSummary {
  totalRuns: number
  completedRuns: number
  failedRuns: number
  runningRuns: number
  successRate: number
  failureRate: number
  avgDurationMs: number
  totalDurationMs: number | null
  firstRun: string | null
  lastRun: string | null
  totalWorkflows: number
  runsPerDay: number
  topNodes: { stepType: string; count: number; avgDurationMs: number; failCount: number }[]
  slowestNodes: { stepType: string; avgDurationMs: number; count: number }[]
}

export interface WorkflowMetricsData {
  workflowId: string
  totalRuns: number
  completedRuns: number
  failedRuns: number
  runningRuns: number
  successRate: number
  avgDurationMs: number
  lastRun: string | null
  totalVersions: number
  slowestSteps: { stepType: string; avgDurationMs: number; count: number }[]
  mostFailedSteps: { stepType: string; failCount: number; totalCount: number; failureRate: number }[]
}

interface RunStatsRow {
  totalRuns: number
  completedRuns: number
  failedRuns: number
  runningRuns: number
  avgDurationMs: number
  totalDurationMs: number
  firstRun: string
  lastRun: string
}

interface WfRunStatsRow {
  totalRuns: number
  completedRuns: number
  failedRuns: number
  runningRuns: number
  avgDurationMs: number
  lastRun: string
}

interface NodeStatsRow {
  stepType: string
  count: number
  avgDurationMs: number
  failCount: number
}

interface SlowNodeRow {
  stepType: string
  avgDurationMs: number
  count: number
}

interface FailNodeRow {
  stepType: string
  failCount: number
  totalCount: number
}

export interface StepExecutionResult {
  stepId: string
  status: "completed" | "failed"
  output?: string
  error?: string
}

export interface ExecuteWorkflowResult {
  success: boolean
  runId: string
  steps: StepExecutionResult[]
  outputs?: Record<string, unknown>
  error?: string
}
