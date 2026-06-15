import type { IncomingMessage, ServerResponse } from "node:http"
import { ulid } from "ulid"
import { globalNodeRegistry } from "@arelyos/flow-sdk"
import { normalizeWorkflow } from "@arelyos/flow-runtime"
import type { Router } from "../transport/router.js"
import type { SSEBus } from "../server/sse.js"
import type { BuilderService, CompileWorkflowResult } from "./builder-service.js"
import type { NodePackageLoader } from "./node-package-loader.js"
import {
  createWorkflow,
  createWorkflowVersion,
  getWorkflowWithCurrentVersion,
} from "../persistence/workflow-store.js"
import {
  createSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
  deleteSchedule,
} from "./scheduler-store.js"
import {
  createSecret,
  getSecret,
  listSecrets,
  updateSecret,
  deleteSecret,
} from "./secrets-store.js"
import { replayRun, replayFromStep } from "./replay-service.js"
import { listInstalledNodes } from "./node-marketplace-store.js"
import type { TemplateRegistry } from "../templates/template-registry.js"
import { TemplateRecommender } from "../templates/template-recommender.js"

const TEMPLATE_RECOMMEND_THRESHOLD = 0.45

export function registerBuilderRoutes(router: Router, builder: BuilderService, sse: SSEBus, loader?: NodePackageLoader, templateRegistry?: TemplateRegistry): void {
  router.get("/builder", serveBuilderPage)
  router.post("/api/flow/compile", handleCompile(builder, templateRegistry))
  router.post("/api/flow/execute", handleExecute(builder))
  router.get("/api/flow/workflows", handleListWorkflows(builder))
  router.get("/api/flow/workflows/:id", handleGetWorkflow(builder))
  router.put("/api/flow/workflows/:id", handleUpdateWorkflow(builder))
  router.delete("/api/flow/workflows/:id", handleDeleteWorkflow(builder))
  router.get("/api/flow/workflows/:id/export", handleExportWorkflow(sse))
  router.post("/api/flow/workflows/import", handleImportWorkflow(sse))
  router.get("/api/flow/workflows/:id/versions", handleListWorkflowVersions(builder))
  router.get("/api/flow/nodes", handleListNodes)
  router.get("/api/flow/runs", handleListRuns(builder))
  router.get("/api/flow/runs/:id", handleGetRun(builder))
  router.get("/api/flow/metrics/summary", handleMetricsSummary(builder))
  router.get("/api/flow/metrics/workflows/:id", handleWorkflowMetrics(builder))
  router.get("/api/flow/schedules", handleListSchedules)
  router.get("/api/flow/schedules/:id", handleGetSchedule)
  router.post("/api/flow/schedules", handleCreateSchedule)
  router.put("/api/flow/schedules/:id", handleUpdateSchedule)
  router.delete("/api/flow/schedules/:id", handleDeleteSchedule)
  router.get("/api/flow/secrets", handleListSecrets)
  router.get("/api/flow/secrets/:id", handleGetSecret)
  router.post("/api/flow/secrets", handleCreateSecret)
  router.put("/api/flow/secrets/:id", handleUpdateSecret)
  router.delete("/api/flow/secrets/:id", handleDeleteSecret)
  router.post("/api/flow/replay", handleReplayRun)
  router.post("/api/flow/replay/:id/from/:stepId", handleReplayFromStep)

  if (loader) {
    router.post("/api/flow/nodes/install", handleInstallNode(loader))
    router.get("/api/flow/nodes/installed", handleListInstalledNodes)
    router.put("/api/flow/nodes/:id/disable", handleDisableNode(loader))
    router.put("/api/flow/nodes/:id/enable", handleEnableNode(loader))
    router.delete("/api/flow/nodes/:id", handleDeleteInstalledNode(loader))
  }
}

function serveBuilderPage(_req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void {
  res.writeHead(200, { "Content-Type": "text/html" })
  res.end(renderBuilderPage())
}

function handleCompile(builder: BuilderService, templateRegistry?: TemplateRegistry) {
  return async (req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): Promise<void> => {
    const body = (req as unknown as { body?: Record<string, unknown> }).body
    const prompt = body?.prompt

    if (!prompt || typeof prompt !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Missing or invalid 'prompt' field" }))
      return
    }

    if (templateRegistry) {
      try {
        const recommender = new TemplateRecommender(templateRegistry)
        const recommendations = recommender.recommend(prompt, 1)
        if (recommendations.length > 0 && recommendations[0].score >= TEMPLATE_RECOMMEND_THRESHOLD) {
          const params = (body?.templateParams as Record<string, unknown> | undefined) ?? {}
          const templateId = recommendations[0].templateId
          const { workflow } = templateRegistry.instantiate(templateId, params)
          const wfRecord = createWorkflow(
            { id: workflow.id, name: workflow.name, description: workflow.description },
          )
          createWorkflowVersion(wfRecord.id, JSON.stringify(workflow), "active")
          workflow.id = wfRecord.id
          const result: CompileWorkflowResult = {
            success: true,
            workflow,
            diagnostics: [{
              phase: "dag_build",
              kind: "warning",
              message: `Used template "${recommendations[0].templateId}" — ${recommendations[0].reason}`,
            }],
          }
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify(result))
          return
        }
      } catch {
        // Template match / instantiation failed — fall through to AI compilation
      }
    }

    const result = await builder.compile(prompt)
    res.writeHead(result.success ? 200 : 422, { "Content-Type": "application/json" })
    res.end(JSON.stringify(result))
  }
}

function handleExecute(builder: BuilderService) {
  return async (req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): Promise<void> => {
    const body = (req as unknown as { body?: Record<string, unknown> }).body
    const workflowId = body?.workflowId
    const triggerInput = (body?.triggerInput as Record<string, unknown> | undefined) ?? {}

    if (!workflowId || typeof workflowId !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Missing or invalid 'workflowId' field" }))
      return
    }

    const result = await builder.execute(workflowId, triggerInput)
    res.writeHead(result.success ? 200 : 422, { "Content-Type": "application/json" })
    res.end(JSON.stringify(result))
  }
}

function handleListWorkflows(builder: BuilderService) {
  return (_req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    const list = builder.listWorkflows()
    const result = list.map((w) => {
      const wf = builder.getWorkflow(w.id)
      return {
        id: w.id,
        description: w.description,
        version: w.version,
        stepCount: wf?.steps.length ?? 0,
      }
    })
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(result))
  }
}

function handleGetWorkflow(builder: BuilderService) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    const wf = builder.getWorkflow(params.id)
    if (!wf) {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Workflow not found" }))
      return
    }
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(wf))
  }
}

const WORKFLOW_EXPORT_FORMAT_VERSION = "1.0" as const

function handleExportWorkflow(sse: SSEBus) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    const entry = getWorkflowWithCurrentVersion(params.id)
    if (!entry || !entry.version) {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Workflow not found" }))
      return
    }

    const workflow = JSON.parse(entry.version.workflowDsl)
    const payload = {
      formatVersion: WORKFLOW_EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      engineVersion: "0.1.0",
      source: {
        workflowId: entry.workflow.id,
        versionId: entry.version.id,
      },
      workflow,
    }

    sse.emitSystem({
      id: ulid(),
      version: 1 as const,
      timestamp: Date.now(),
      type: "workflow_exported",
      workflowId: entry.workflow.id,
      exportedAt: new Date().toISOString(),
    })

    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(payload))
  }
}

function handleImportWorkflow(sse: SSEBus) {
  return (req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    try {
    const body = (req as unknown as { body?: Record<string, unknown> }).body
    if (!body) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Invalid JSON body" }))
      return
    }

    if (body.formatVersion !== WORKFLOW_EXPORT_FORMAT_VERSION) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Unsupported formatVersion: ${body.formatVersion}` }))
      return
    }

    const rawWorkflow = body.workflow as Record<string, unknown> | undefined
    if (!rawWorkflow) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Missing 'workflow' field in payload" }))
      return
    }

    let workflow: ReturnType<typeof normalizeWorkflow>
    try {
      workflow = normalizeWorkflow(rawWorkflow)
    } catch (err) {
      res.writeHead(422, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Invalid workflow: ${err instanceof Error ? err.message : String(err)}` }))
      return
    }

    const newId = ulid()
    const importedWorkflow = { ...workflow, id: newId }
    const record = createWorkflow({ id: newId, name: importedWorkflow.name, description: importedWorkflow.description })
    const version = createWorkflowVersion(record.id, JSON.stringify(importedWorkflow), "active")

    sse.emitSystem({
      id: ulid(),
      version: 1 as const,
      timestamp: Date.now(),
      type: "workflow_imported",
      workflowId: record.id,
      importedAt: new Date().toISOString(),
      sourceFormatVersion: body.formatVersion as string,
    })

    res.writeHead(201, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ workflowId: record.id, versionId: version.id }))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Import failed: ${err instanceof Error ? err.message : String(err)}` }))
    }
  }
}

function handleListNodes(_req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void {
  const nodes = globalNodeRegistry.list().map((def) => ({
    type: def.type,
    label: def.label,
    category: def.category,
  }))
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify(nodes))
}

function handleListRuns(builder: BuilderService) {
  return (req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    const url = new URL(req.url ?? "", "http://localhost")
    const workflowId = url.searchParams.get("workflowId") ?? undefined
    const status = url.searchParams.get("status") ?? undefined
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined

    const runs = builder.listRuns({ workflowId, status, limit })
    const result = runs.map(({ run, steps }) => ({
      run: { ...run, triggerInput: run.triggerInput ? JSON.parse(run.triggerInput) : null },
      steps: steps.map((s) => ({
        ...s,
        input: s.input ? JSON.parse(s.input) : null,
        output: s.output ?? undefined,
        error: s.error ?? undefined,
      })),
    }))

    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(result))
  }
}

function handleGetRun(builder: BuilderService) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    const full = builder.getRun(params.id)
    if (!full) {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Run not found" }))
      return
    }
    const result = {
      run: { ...full.run, triggerInput: full.run.triggerInput ? JSON.parse(full.run.triggerInput) : null },
      steps: full.steps.map((s) => ({
        ...s,
        input: s.input ? JSON.parse(s.input) : null,
        output: s.output ?? undefined,
        error: s.error ?? undefined,
      })),
    }
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(result))
  }
}

function handleUpdateWorkflow(builder: BuilderService) {
  return (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    const body = (req as unknown as { body?: Record<string, unknown> }).body
    if (!body || (!body.name && !body.description)) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Provide 'name' or 'description'" }))
      return
    }
    builder.updateWorkflow(params.id, {
      name: body.name as string | undefined,
      description: body.description as string | undefined,
    })
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ success: true }))
  }
}

function handleDeleteWorkflow(builder: BuilderService) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    builder.deleteWorkflow(params.id)
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ success: true }))
  }
}

function handleListWorkflowVersions(builder: BuilderService) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    const versions = builder.listWorkflowVersions(params.id)
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(versions))
  }
}

function handleMetricsSummary(builder: BuilderService) {
  return (_req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    const metrics = builder.getMetricsSummary()
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(metrics))
  }
}

function handleWorkflowMetrics(builder: BuilderService) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    const metrics = builder.getWorkflowMetrics(params.id)
    if (!metrics) {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Workflow not found" }))
      return
    }
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(metrics))
  }
}

// Schedule handlers
function handleListSchedules(_req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void {
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify(listSchedules()))
}

function handleGetSchedule(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void {
  const schedule = getSchedule(params.id)
  if (!schedule) {
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Schedule not found" }))
    return
  }
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify(schedule))
}

function handleCreateSchedule(req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void {
  const body = (req as unknown as { body?: Record<string, unknown> }).body
  if (!body?.workflowId || !body?.triggerMode) {
    res.writeHead(400, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Missing 'workflowId' or 'triggerMode'" }))
    return
  }
  const schedule = createSchedule(
    body.workflowId as string,
    body.triggerMode as string,
    (body.cronExpression as string) ?? null,
    (body.intervalMs as number) ?? null,
  )
  res.writeHead(201, { "Content-Type": "application/json" })
  res.end(JSON.stringify(schedule))
}

function handleUpdateSchedule(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void {
  const body = (req as unknown as { body?: Record<string, unknown> }).body
  if (!body || Object.keys(body).length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "No fields to update" }))
    return
  }
  const updates: Record<string, unknown> = {}
  if (body.triggerMode !== undefined) updates.triggerMode = body.triggerMode
  if (body.cronExpression !== undefined) updates.cronExpression = body.cronExpression
  if (body.intervalMs !== undefined) updates.intervalMs = body.intervalMs
  if (body.enabled !== undefined) updates.enabled = body.enabled
  updateSchedule(params.id, updates)
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ success: true }))
}

function handleDeleteSchedule(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void {
  deleteSchedule(params.id)
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ success: true }))
}

// Secrets handlers
function handleListSecrets(_req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void {
  const list = listSecrets().map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt, updatedAt: s.updatedAt }))
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify(list))
}

function handleGetSecret(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void {
  const secret = getSecret(params.id)
  if (!secret) {
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Secret not found" }))
    return
  }
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify(secret))
}

function handleCreateSecret(req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void {
  const body = (req as unknown as { body?: Record<string, unknown> }).body
  if (!body?.name || !body?.value) {
    res.writeHead(400, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Missing 'name' or 'value'" }))
    return
  }
  const secret = createSecret(body.name as string, body.value as string)
  res.writeHead(201, { "Content-Type": "application/json" })
  res.end(JSON.stringify(secret))
}

function handleUpdateSecret(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void {
  const body = (req as unknown as { body?: Record<string, unknown> }).body
  if (!body?.value) {
    res.writeHead(400, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Missing 'value'" }))
    return
  }
  updateSecret(params.id, body.value as string)
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ success: true }))
}

function handleDeleteSecret(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void {
  deleteSecret(params.id)
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ success: true }))
}

// Replay handlers
function handleReplayRun(req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void {
  const body = (req as unknown as { body?: Record<string, unknown> }).body
  if (!body?.runId) {
    res.writeHead(400, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Missing 'runId'" }))
    return
  }
  replayRun(body.runId as string, { triggerInput: body.triggerInput as Record<string, unknown> | undefined }).then((result) => {
    res.writeHead(result.success ? 200 : 422, { "Content-Type": "application/json" })
    res.end(JSON.stringify(result))
  }).catch((err) => {
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: String(err) }))
  })
}

function handleReplayFromStep(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void {
  const body = (req as unknown as { body?: Record<string, unknown> }).body
  replayFromStep(params.id, params.stepId, { triggerInput: (body?.triggerInput as Record<string, unknown>) ?? {} }).then((result) => {
    res.writeHead(result.success ? 200 : 422, { "Content-Type": "application/json" })
    res.end(JSON.stringify(result))
  }).catch((err) => {
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: String(err) }))
  })
}

// Node Marketplace handlers (M1)
function handleInstallNode(loader: NodePackageLoader) {
  return async (req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): Promise<void> => {
    const body = (req as unknown as { body?: Record<string, unknown> }).body
    const pkgPath = body?.path
    if (!pkgPath || typeof pkgPath !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Missing or invalid 'path' field" }))
      return
    }
    try {
      const record = await loader.loadPackage(pkgPath)
      res.writeHead(201, { "Content-Type": "application/json" })
      res.end(JSON.stringify(record))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const status = message.includes("already") ? 409 : 422
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: message }))
    }
  }
}

function handleListInstalledNodes(_req: IncomingMessage, res: ServerResponse, _params: Record<string, unknown>): void {
  const records = listInstalledNodes().map((r) => ({
    id: r.id,
    name: r.name,
    version: r.version,
    nodeType: r.nodeType,
    category: r.category,
    description: r.description,
    author: r.author,
    manifestVersion: r.manifestVersion,
    installedAt: r.installedAt,
    enabled: r.enabled,
  }))
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify(records))
}

function handleDisableNode(loader: NodePackageLoader) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      loader.disable(params.id)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ success: true }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      res.writeHead(message.includes("not found") ? 404 : 422, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: message }))
    }
  }
}

function handleEnableNode(loader: NodePackageLoader) {
  return async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> => {
    try {
      await loader.enable(params.id)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ success: true }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      res.writeHead(message.includes("not found") ? 404 : 422, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: message }))
    }
  }
}

function handleDeleteInstalledNode(loader: NodePackageLoader) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      loader.remove(params.id)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ success: true }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      res.writeHead(message.includes("not found") ? 404 : 422, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: message }))
    }
  }
}

function renderBuilderPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Arely — AI Builder</title>
<style>
  :root { --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #c9d1d9; --text-muted: #8b949e; --accent: #58a6ff; --success: #3fb950; --error: #f85149; --warn: #d29922; --radius: 8px; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; }
  header { border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 18px; font-weight: 600; }
  header .version { color: var(--text-muted); font-size: 12px; margin-left: 8px; }
  .status-badge { font-size: 11px; padding: 2px 10px; border-radius: 12px; font-weight: 500; }
  .status-idle { background: #21262d; color: var(--text-muted); }
  .status-compiling { background: #1f3a5f; color: var(--accent); }
  .status-compiled { background: #1a3a2a; color: var(--success); }
  .status-executing { background: #1f3a5f; color: var(--accent); }
  .status-error { background: #3d1f1f; color: var(--error); }
  .container { display: grid; grid-template-columns: 1fr 1fr; gap: 0; flex: 1; }
  @media (max-width: 900px) { .container { grid-template-columns: 1fr; } }
  .panel { display: flex; flex-direction: column; border-right: 1px solid var(--border); overflow: hidden; }
  .panel:last-child { border-right: none; }
  .panel-header { padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 13px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .chat-area { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .msg { border-radius: var(--radius); padding: 12px 16px; max-width: 90%; line-height: 1.5; }
  .msg.user { background: #1f3a5f; align-self: flex-end; }
  .msg.system { background: var(--surface); align-self: flex-start; border: 1px solid var(--border); }
  .msg .label { font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--text-muted); }
  .msg .diag { font-size: 12px; margin: 4px 0; padding: 2px 8px; border-radius: 4px; }
  .msg .diag.warn { background: #2d2410; color: var(--warn); }
  .msg .diag.err { background: #3d1f1f; color: var(--error); }
  .input-area { border-top: 1px solid var(--border); padding: 12px 16px; display: flex; gap: 8px; }
  .input-area textarea { flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); padding: 10px 12px; font-size: 14px; resize: none; min-height: 44px; max-height: 120px; font-family: inherit; }
  .input-area textarea:focus { outline: none; border-color: var(--accent); }
  .input-area button { background: var(--accent); color: #fff; border: none; border-radius: var(--radius); padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
  .input-area button:hover:not(:disabled) { filter: brightness(1.15); }
  .preview-tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--surface); }
  .preview-tabs button { background: none; border: none; color: var(--text-muted); padding: 10px 20px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; font-family: inherit; }
  .preview-tabs button.active { color: var(--text); border-bottom-color: var(--accent); }
  .preview-content { flex: 1; overflow-y: auto; padding: 16px; }
  .preview-content pre { font-family: 'JetBrains Mono','Fira Code','Cascadia Code',monospace; font-size: 13px; white-space: pre-wrap; word-break: break-all; }
  .step-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 13px; }
  .step-row .icon { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .step-row .icon.done { background: var(--success); }
  .step-row .icon.fail { background: var(--error); }
  .step-row .icon.pending { background: var(--text-muted); }
  .step-row .icon.running { background: var(--accent); animation: pulse 1s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  .step-row .msg-text { color: var(--text-muted); font-size: 12px; margin-left: auto; }
  .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); font-size: 14px; gap: 8px; text-align: center; padding: 40px; }
  .metrics-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .metric-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
  .metric-card .value { font-size: 28px; font-weight: 700; color: var(--text); }
  .metric-card .label { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
  .metric-card .value.green { color: var(--success); }
  .metric-card .value.red { color: var(--error); }
  .metric-card .value.blue { color: var(--accent); }
  .metric-card .value.orange { color: var(--warn); }
  .metrics-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px; }
  .metrics-table th { text-align: left; padding: 8px 10px; border-bottom: 2px solid var(--border); color: var(--text-muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  .metrics-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); }
  .metrics-table tr:hover td { background: rgba(88,166,255,0.05); }
  .metrics-section-title { font-size: 14px; font-weight: 600; margin: 16px 0 10px; color: var(--text); }
  .metrics-refresh { float: right; background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 4px; padding: 4px 12px; font-size: 12px; cursor: pointer; }
  .empty-state .icon { font-size: 32px; opacity: 0.3; }
  .nav-links { margin-left: auto; display: flex; gap: 16px; }
  .nav-links a { color: var(--text-muted); text-decoration: none; font-size: 13px; }
  .nav-links a:hover { color: var(--text); }
</style>
</head>
<body>
<header>
  <h1>AI Builder <span class="version">v1.0</span></h1>
  <span id="status-badge" class="status-badge status-idle">Idle</span>
  <div class="nav-links">
    <a href="/dashboard">Dashboard</a>
  </div>
</header>
<div class="container">
  <div class="panel">
    <div class="panel-header">Chat</div>
    <div id="chat" class="chat-area">
      <div class="msg system">
        <div class="label">AI Builder</div>
        Describe the workflow you want to build. For example:<br>
        <em>"fetch user data from an API and send the results by email"</em>
      </div>
    </div>
    <div class="input-area">
      <textarea id="prompt-input" rows="1" placeholder="Describe your workflow..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendPrompt()}"></textarea>
      <button id="send-btn" onclick="sendPrompt()">Send</button>
    </div>
  </div>
  <div class="panel">
    <div class="panel-header">Preview</div>
    <div class="preview-tabs">
      <button class="active" onclick="switchPreviewTab('dsl')">DSL</button>
      <button onclick="switchPreviewTab('exec')">Execution</button>
      <button onclick="switchPreviewTab('metrics')">Metrics</button>
    </div>
    <div id="tab-dsl" class="preview-content">
      <div class="empty-state">
        <div class="icon">⚡</div>
        <div>Compile a workflow to see its DSL here</div>
      </div>
    </div>
    <div id="tab-exec" class="preview-content" style="display:none">
      <div id="exec-log" class="empty-state">
        <div class="icon">▶</div>
        <div>Execute a workflow to see step results here</div>
      </div>
    </div>
    <div id="tab-metrics" class="preview-content" style="display:none">
      <div id="metrics-panel" class="empty-state">
        <div class="icon">📊</div>
        <div>Run workflows to see metrics here</div>
      </div>
    </div>
  </div>
</div>
<script>
let currentWorkflowId = null;
let statusEl = document.getElementById('status-badge');
let chatEl = document.getElementById('chat');
let dslTab = document.getElementById('tab-dsl');
let execTab = document.getElementById('tab-exec');
let execLog = document.getElementById('exec-log');

function setState(state, label) {
  statusEl.className = 'status-badge status-' + state;
  statusEl.textContent = label;
}

function addMsg(type, html) {
  var div = document.createElement('div');
  div.className = 'msg ' + type;
  var label = document.createElement('div');
  label.className = 'label';
  label.textContent = type === 'user' ? 'You' : 'AI Builder';
  div.appendChild(label);
  div.innerHTML += html;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addDiag(msg, kind) {
  return '<div class="diag ' + kind + '">' + esc(msg) + '</div>';
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function switchPreviewTab(tab) {
  document.querySelectorAll('.preview-tabs button').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.preview-content').forEach(function(p) { p.style.display = 'none'; });
  document.querySelector('.preview-tabs button[onclick*="' + tab + '"]').classList.add('active');
  document.getElementById('tab-' + tab).style.display = '';
}

function sendPrompt() {
  var input = document.getElementById('prompt-input');
  var btn = document.getElementById('send-btn');
  var prompt = input.value.trim();
  if (!prompt) return;

  addMsg('user', esc(prompt));
  input.value = '';
  btn.disabled = true;
  setState('compiling', 'Compiling...');

  fetch('/api/flow/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: prompt })
  })
  .then(function(r) { return r.json(); })
  .then(function(result) {
    if (result.success && result.workflow) {
      currentWorkflowId = result.workflow.id;
      setState('compiled', 'Compiled');
      showWorkflow(result.workflow, result.diagnostics);
    } else {
      setState('error', 'Error');
      var errors = (result.diagnostics || []).filter(function(d) { return d.kind === 'error'; });
      var html = '<div class="label">AI Builder</div><strong>Compilation failed</strong>';
      errors.forEach(function(d) { html += addDiag(d.message, 'err'); });
      addMsg('system', html);
    }
    btn.disabled = false;
  })
  .catch(function(err) {
    setState('error', 'Error');
    addMsg('system', '<strong>Request failed:</strong> ' + esc(err.message));
    btn.disabled = false;
  });
}

function showWorkflow(wf, diagnostics) {
  // DSL tab
  dslTab.innerHTML = '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">' +
    '<span style="color:var(--success);font-weight:600">' + esc(wf.steps.length) + ' steps</span>' +
    '<span style="color:var(--text-muted);font-size:12px">|</span>' +
    '<span style="color:var(--text-muted);font-size:12px">id: ' + esc(wf.id) + '</span>' +
    '<button style="margin-left:auto;background:var(--accent);color:#fff;border:none;border-radius:4px;padding:6px 14px;font-size:12px;cursor:pointer" onclick="executeWorkflow()">▶ Run</button>' +
    '</div>' +
    '<pre>' + esc(JSON.stringify(wf, null, 2)) + '</pre>';

  // Warnings
  var warnings = (diagnostics || []).filter(function(d) { return d.kind === 'warning'; });
  if (warnings.length > 0) {
    dslTab.innerHTML += '<div style="margin-top:12px"><strong style="font-size:12px;color:var(--warn)">Warnings:</strong>';
    warnings.forEach(function(w) { dslTab.innerHTML += '<div style="font-size:12px;color:var(--warn);padding:2px 0">' + esc(w.message) + '</div>'; });
    dslTab.innerHTML += '</div>';
  }

  // Chat message
  var html = '<strong>Workflow compiled</strong><br>' +
    '<span style="color:var(--success)">' + wf.steps.length + ' step' + (wf.steps.length !== 1 ? 's' : '') + '</span>';
  if (wf.trigger) {
    html += ' &middot; trigger: ' + esc(wf.trigger.type);
  }
  html += '<br><br><button onclick="executeWorkflow()" style="background:var(--success);color:#fff;border:none;border-radius:4px;padding:6px 16px;font-size:13px;font-weight:600;cursor:pointer">▶ Run Workflow</button>';
  addMsg('system', html);
}

function executeWorkflow() {
  if (!currentWorkflowId) return;
  setState('executing', 'Executing...');
  execLog.innerHTML = '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Executing <strong>' + esc(currentWorkflowId) + '</strong>...</div>';

  fetch('/api/flow/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId: currentWorkflowId })
  })
  .then(function(r) { return r.json(); })
  .then(function(result) {
    // Switch to exec tab
    switchPreviewTab('exec');
    if (result.success) {
      setState('completed', 'Completed');
      renderExecLog(result.steps);
      addMsg('system', '<strong>Workflow completed</strong> &middot; ' + result.steps.length + ' steps, all passed');
    } else {
      setState('error', 'Failed');
      renderExecLog(result.steps || []);
      addMsg('system', '<strong>Workflow failed</strong>' + (result.error ? ': ' + esc(result.error) : ''));
    }
  })
  .catch(function(err) {
    setState('error', 'Error');
    execLog.innerHTML = '<div style="color:var(--error)">Error: ' + esc(err.message) + '</div>';
  });
}

function renderExecLog(steps) {
  if (!steps || steps.length === 0) {
    execLog.innerHTML = '<div style="color:var(--text-muted)">No steps executed</div>';
    return;
  }
  var html = '';
  steps.forEach(function(s) {
    var iconClass = s.status === 'completed' ? 'done' : 'fail';
    var statusText = s.status === 'completed' ? 'OK' : 'FAIL';
    html += '<div class="step-row">' +
      '<span class="icon ' + iconClass + '"></span>' +
      '<strong>' + esc(s.stepId) + '</strong>' +
      '<span style="color:var(--text-muted);font-size:12px">' + esc(s.type || '') + '</span>' +
      '<span style="margin-left:auto">' +
        (s.output ? '<span class="msg-text" title="' + esc(s.output.slice(0,200)) + '">' + esc(s.output.slice(0,60)) + '</span>' : '') +
        '<span style="font-size:11px;padding:1px 6px;border-radius:4px;margin-left:6px;' +
          (s.status === 'completed' ? 'background:#1a3a2a;color:var(--success)' : 'background:#3d1f1f;color:var(--error)') +
        '">' + statusText + '</span>' +
      '</span></div>';
    if (s.error) {
      html += '<div style="font-size:12px;color:var(--error);padding:0 0 6px 16px">' + esc(s.error) + '</div>';
    }
  });
  execLog.innerHTML = html;
}

// Metrics
function loadMetrics() {
  var panel = document.getElementById('metrics-panel');
  panel.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">Loading metrics...</div>';

  fetch('/api/flow/metrics/summary')
    .then(function(r) { return r.json(); })
    .then(function(m) {
      panel.innerHTML = renderMetrics(m);
    })
    .catch(function(err) {
      panel.innerHTML = '<div style="color:var(--error);padding:20px">Failed to load metrics: ' + esc(err.message) + '</div>';
    });
}

function renderMetrics(m) {
  var html = '';

  // KPI cards
  html += '<div class="metrics-grid">' +
    '<div class="metric-card"><div class="value ' + (m.successRate >= 80 ? 'green' : m.successRate > 0 ? 'orange' : '') + '">' + m.successRate + '%</div><div class="label">Success Rate</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + m.completedRuns + ' of ' + m.totalRuns + ' runs</div></div>' +
    '<div class="metric-card"><div class="value blue">' + m.totalRuns + '</div><div class="label">Total Runs</div></div>' +
    '<div class="metric-card"><div class="value blue">' + (m.runsPerDay > 0 ? m.runsPerDay + '/day' : '—') + '</div><div class="label">Runs per Day</div></div>' +
    '<div class="metric-card"><div class="value blue">' + (m.avgDurationMs > 0 ? (m.avgDurationMs / 1000).toFixed(1) + 's' : '—') + '</div><div class="label">Avg Duration</div></div>' +
    '<div class="metric-card"><div class="value green">' + m.completedRuns + '</div><div class="label">Completed</div></div>' +
    '<div class="metric-card"><div class="value ' + (m.failedRuns > 0 ? 'red' : '') + '">' + m.failedRuns + '</div><div class="label">Failed</div></div>' +
    '<div class="metric-card"><div class="value blue">' + (m.totalDurationMs > 0 ? (m.totalDurationMs / 1000).toFixed(0) + 's' : '—') + '</div><div class="label">Total Duration</div></div>' +
    '<div class="metric-card"><div class="value blue">' + m.totalWorkflows + '</div><div class="label">Workflows</div></div>' +
    '<div class="metric-card"><div class="value blue">' + m.runningRuns + '</div><div class="label">Running</div></div>' +
  '</div>';

  // Top nodes
  if (m.topNodes && m.topNodes.length > 0) {
    html += '<div class="metrics-section-title">Most Used Nodes <button class="metrics-refresh" onclick="loadMetrics()">Refresh</button></div>';
    html += '<table class="metrics-table"><thead><tr><th>Node Type</th><th>Executions</th><th>Avg Duration</th><th>Failures</th><th>Failure Rate</th></tr></thead><tbody>';
    m.topNodes.forEach(function(n) {
      var failRate = n.count > 0 ? Math.round(n.failCount / n.count * 100) : 0;
      html += '<tr><td><strong>' + esc(n.stepType) + '</strong></td><td>' + n.count + '</td><td>' + (n.avgDurationMs > 0 ? (n.avgDurationMs / 1000).toFixed(2) + 's' : '—') + '</td><td>' + (n.failCount > 0 ? '<span style="color:var(--error)">' + n.failCount + '</span>' : '0') + '</td><td>' + (failRate > 0 ? '<span style="color:var(--error)">' + failRate + '%</span>' : '0%') + '</td></tr>';
    });
    html += '</tbody></table>';
  }

  // Slowest nodes
  if (m.slowestNodes && m.slowestNodes.length > 0) {
    html += '<div class="metrics-section-title">Slowest Nodes</div>';
    html += '<table class="metrics-table"><thead><tr><th>Node Type</th><th>Avg Duration</th><th>Executions</th></tr></thead><tbody>';
    m.slowestNodes.forEach(function(n) {
      html += '<tr><td><strong>' + esc(n.stepType) + '</strong></td><td>' + (n.avgDurationMs > 0 ? '<span style="color:var(--warn)">' + (n.avgDurationMs / 1000).toFixed(2) + 's</span>' : '—') + '</td><td>' + n.count + '</td></tr>';
    });
    html += '</tbody></table>';
  }

  if (m.totalRuns === 0) {
    html = '<div class="empty-state"><div class="icon">📊</div><div>No runs yet — execute a workflow to see metrics</div></div>';
  }

  return html;
}

// Override switchPreviewTab to load metrics when switching to that tab
var origSwitch = switchPreviewTab;
switchPreviewTab = function(tab) {
  if (tab === 'metrics') loadMetrics();
  origSwitch(tab);
};
</script>
</body>
</html>`
}
