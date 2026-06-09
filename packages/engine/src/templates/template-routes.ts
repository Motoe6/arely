import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { IncomingMessage, ServerResponse } from "node:http"
import { ulid } from "ulid"
import { stringify as stringifyYAML } from "yaml"
import type { Router } from "../transport/router.js"
import type { SSEBus } from "../server/sse.js"
import type { TemplateRegistry } from "./template-registry.js"
import type { TemplateMetadata, TemplateSource } from "./template-types.js"
import { TemplateRecommender } from "./template-recommender.js"
import {
  TemplateNotFoundError,
  TemplateValidationError,
  MissingNodeRequirementError,
} from "./template-types.js"
import { getWorkflowWithCurrentVersion } from "../persistence/workflow-store.js"

export function registerTemplateRoutes(
  router: Router,
  registry: TemplateRegistry,
  builtinDir: string,
  userDir: string,
  sse?: SSEBus,
): void {
  router.get("/api/flow/templates/categories", handleListCategories(registry))
  router.get("/api/flow/templates", handleListTemplates(registry))
  router.get("/api/flow/templates/:id", handleGetTemplate(registry, builtinDir, userDir))
  router.post("/api/flow/templates/:id/instantiate", handleInstantiate(registry))
  router.post("/api/flow/templates", handleCreateTemplate(registry, userDir, sse))
  router.put("/api/flow/templates/:id", handleUpdateTemplate(registry, userDir))
  router.delete("/api/flow/templates/:id", handleDeleteTemplate(registry, userDir, sse))
  router.post("/api/flow/workflows/:id/save-as-template", handleSaveAsTemplate(registry, userDir, sse))
  router.post("/api/flow/templates/recommend", handleRecommend(registry))
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

function handleListCategories(registry: TemplateRegistry) {
  return (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(registry.listCategories()))
  }
}

function handleListTemplates(registry: TemplateRegistry) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
    const category = url.searchParams.get("category") ?? undefined
    const tag = url.searchParams.get("tag") ?? undefined

    let results = category ? registry.list(category) : registry.list()
    if (tag) {
      results = results.filter((m) => m.tags.includes(tag))
    }

    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(results))
  }
}

function handleGetTemplate(registry: TemplateRegistry, builtinDir: string, userDir: string) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const template = registry.get(params.id)
    if (!template) {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        error: { code: "TEMPLATE_NOT_FOUND", message: `Template "${params.id}" not found` },
      }))
      return
    }

    let readme = ""
    const readmePaths = [join(builtinDir, params.id, "README.md"), join(userDir, params.id, "README.md")]
    for (const p of readmePaths) {
      try {
        if (existsSync(p)) {
          readme = readFileSync(p, "utf-8")
          break
        }
      } catch { /* try next */ }
    }

    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({
      metadata: template.metadata,
      workflowDsl: template.workflowDsl,
      readme,
    }))
  }
}

function handleInstantiate(registry: TemplateRegistry) {
  return (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const body = ((req as unknown as Record<string, unknown>).body ?? {}) as Record<string, unknown>
    const userParams = (body.params ?? {}) as Record<string, unknown>

    try {
      const result = registry.instantiate(params.id, userParams)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
    } catch (err) {
      if (err instanceof TemplateNotFoundError) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({
          error: { code: "TEMPLATE_NOT_FOUND", message: err.message },
        }))
      } else if (err instanceof MissingNodeRequirementError) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({
          error: { code: "MISSING_NODE_REQUIREMENT", message: err.message },
        }))
      } else {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({
          error: { code: "TEMPLATE_VALIDATION_ERROR", message: err instanceof Error ? err.message : String(err) },
        }))
      }
    }
  }
}

function handleCreateTemplate(registry: TemplateRegistry, userDir: string, sse?: SSEBus) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const body = ((req as unknown as Record<string, unknown>).body ?? {}) as Record<string, unknown>

    if (!body.name || typeof body.name !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Field 'name' is required and must be a string" }))
      return
    }
    if (!body.description || typeof body.description !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Field 'description' is required and must be a string" }))
      return
    }
    if (!body.category || typeof body.category !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Field 'category' is required and must be a string" }))
      return
    }
    if (!body.workflowYaml || typeof body.workflowYaml !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Field 'workflowYaml' is required and must be a string" }))
      return
    }

    const id = typeof body.id === "string" && body.id.length > 0 ? body.id : slugify(body.name)
    if (!id) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Could not generate a valid template id from 'name'" }))
      return
    }

    if (registry.get(id)) {
      res.writeHead(409, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Template already exists: "${id}"` }))
      return
    }

    const metadata: TemplateMetadata = {
      id,
      name: body.name,
      description: body.description,
      category: body.category,
      tags: Array.isArray(body.tags) ? (body.tags as string[]).filter((t) => typeof t === "string") : [],
      templateVersion: typeof body.templateVersion === "string" ? body.templateVersion : "1.0.0",
      author: typeof body.author === "string" ? body.author : "User",
      parameters: Array.isArray(body.parameters) ? body.parameters as TemplateMetadata["parameters"] : [],
      requires: Array.isArray(body.requires) ? (body.requires as string[]).filter((r) => typeof r === "string") : [],
      source: "user",
    }

    const dirPath = join(userDir, id)
    mkdirSync(dirPath, { recursive: true })
    writeFileSync(join(dirPath, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8")
    writeFileSync(join(dirPath, "template.yaml"), body.workflowYaml, "utf-8")

    try {
      registry.registerTemplate(dirPath, "user")
    } catch (err) {
      rmSync(dirPath, { recursive: true, force: true })
      res.writeHead(422, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }))
      return
    }

    if (sse) {
      sse.emitSystem({
        id: ulid(),
        version: 1 as const,
        timestamp: Date.now(),
        type: "template_created",
        templateId: metadata.id,
        name: metadata.name,
        source: "user",
      })
    }

    res.writeHead(201, { "Content-Type": "application/json" })
    res.end(JSON.stringify(metadata))
  }
}

function handleUpdateTemplate(registry: TemplateRegistry, userDir: string) {
  return (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const existing = registry.get(params.id)
    if (!existing) {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        error: { code: "TEMPLATE_NOT_FOUND", message: `Template "${params.id}" not found` },
      }))
      return
    }
    if (existing.metadata.source === "builtin" || existing.metadata.source === "package") {
      res.writeHead(403, { "Content-Type": "application/json" })
      const kind = existing.metadata.source === "package" ? "package" : "built-in"
      res.end(JSON.stringify({ error: `Cannot modify ${kind} template "${params.id}"` }))
      return
    }

    const body = ((req as unknown as Record<string, unknown>).body ?? {}) as Record<string, unknown>
    const cur = existing.metadata

    const updated: TemplateMetadata = {
      ...cur,
      name: typeof body.name === "string" ? body.name : cur.name,
      description: typeof body.description === "string" ? body.description : cur.description,
      category: typeof body.category === "string" ? body.category : cur.category,
      tags: Array.isArray(body.tags) ? (body.tags as string[]).filter((t) => typeof t === "string") : cur.tags,
      templateVersion: typeof body.templateVersion === "string" ? body.templateVersion : cur.templateVersion,
      author: typeof body.author === "string" ? body.author : cur.author,
      parameters: Array.isArray(body.parameters) ? body.parameters as TemplateMetadata["parameters"] : cur.parameters,
      requires: Array.isArray(body.requires) ? (body.requires as string[]).filter((r) => typeof r === "string") : cur.requires,
    }

    const dirPath = join(userDir, params.id)
    mkdirSync(dirPath, { recursive: true })
    writeFileSync(join(dirPath, "metadata.json"), JSON.stringify(updated, null, 2), "utf-8")
    if (typeof body.workflowYaml === "string") {
      writeFileSync(join(dirPath, "template.yaml"), body.workflowYaml, "utf-8")
    }

    registry.unregisterTemplate(params.id)
    try {
      registry.registerTemplate(dirPath, "user")
    } catch (err) {
      res.writeHead(422, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }))
      return
    }

    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(updated))
  }
}

function handleDeleteTemplate(registry: TemplateRegistry, userDir: string, sse?: SSEBus) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const existing = registry.get(params.id)
    if (!existing) {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        error: { code: "TEMPLATE_NOT_FOUND", message: `Template "${params.id}" not found` },
      }))
      return
    }
    if (existing.metadata.source === "builtin" || existing.metadata.source === "package") {
      res.writeHead(403, { "Content-Type": "application/json" })
      const kind = existing.metadata.source === "package" ? "package" : "built-in"
      res.end(JSON.stringify({ error: `Cannot delete ${kind} template "${params.id}"` }))
      return
    }

    const dirPath = join(userDir, params.id)
    try {
      rmSync(dirPath, { recursive: true, force: true })
    } catch { /* best effort */ }

    registry.unregisterTemplate(params.id)

    if (sse) {
      sse.emitSystem({
        id: ulid(),
        version: 1 as const,
        timestamp: Date.now(),
        type: "template_deleted",
        templateId: params.id,
        name: existing.metadata.name,
        source: existing.metadata.source,
      })
    }

    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ success: true }))
  }
}

function handleSaveAsTemplate(registry: TemplateRegistry, userDir: string, sse?: SSEBus) {
  return (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const workflowId = params.id

    const entry = getWorkflowWithCurrentVersion(workflowId)
    if (!entry || !entry.version) {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        error: { code: "WORKFLOW_NOT_FOUND", message: `Workflow "${workflowId}" not found or has no current version` },
      }))
      return
    }

    const workflow = JSON.parse(entry.version.workflowDsl) as Record<string, unknown>

    delete workflow.id
    delete workflow.createdAt
    delete workflow.updatedAt
    delete workflow.versionId
    delete workflow.executionStats
    delete workflow.lastRun

    if (workflow.metadata && typeof workflow.metadata === "object") {
      const meta = workflow.metadata as Record<string, unknown>
      delete meta.template
      if (Object.keys(meta).length === 0) {
        delete workflow.metadata
      }
    }

    const body = ((req as unknown as Record<string, unknown>).body ?? {}) as Record<string, unknown>

    const name =
      (typeof body.name === "string" && body.name.trim() ? body.name : undefined) ??
      (typeof workflow.name === "string" ? workflow.name : undefined) ??
      (entry.workflow.name ?? undefined) ??
      "Untitled"

    const templateId = slugify(name)
    if (!templateId) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Could not generate a valid template id from 'name'" }))
      return
    }

    if (registry.get(templateId)) {
      res.writeHead(409, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Template already exists: "${templateId}"` }))
      return
    }

    const steps = (Array.isArray(workflow.steps) ? workflow.steps : []) as Array<{ type: string }>
    const requires = [...new Set(steps.map((s) => s.type))]

    const workflowYaml = stringifyYAML(workflow)

    const metadata: TemplateMetadata = {
      id: templateId,
      name,
      description: typeof body.description === "string" && body.description
        ? body.description
        : (typeof workflow.description === "string" && workflow.description
          ? workflow.description
          : name),
      category: typeof body.category === "string" ? body.category : "custom",
      tags: Array.isArray(body.tags) ? (body.tags as string[]).filter((t) => typeof t === "string") : [],
      templateVersion: typeof body.templateVersion === "string" ? body.templateVersion : "1.0.0",
      author: typeof body.author === "string" ? body.author : "User",
      parameters: [],
      requires,
      source: "user",
    }

    const dirPath = join(userDir, templateId)

    try {
      mkdirSync(dirPath, { recursive: true })
      writeFileSync(join(dirPath, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8")
      writeFileSync(join(dirPath, "template.yaml"), workflowYaml, "utf-8")
    } catch (err) {
      try { rmSync(dirPath, { recursive: true, force: true }) } catch { /* ok */ }
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
      return
    }

    try {
      registry.registerTemplate(dirPath, "user")
    } catch (err) {
      registry.unregisterTemplate(templateId)
      try { rmSync(dirPath, { recursive: true, force: true }) } catch { /* ok */ }
      res.writeHead(422, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
      return
    }

    if (sse) {
      sse.emitSystem({
        id: ulid(),
        version: 1 as const,
        timestamp: Date.now(),
        type: "template_created",
        templateId: metadata.id,
        name: metadata.name,
        source: "user",
      })
    }

    res.writeHead(201, { "Content-Type": "application/json" })
    res.end(JSON.stringify(metadata))
  }
}

function handleRecommend(registry: TemplateRegistry) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const body = ((req as unknown as Record<string, unknown>).body ?? {}) as Record<string, unknown>
    const query = typeof body.query === "string" ? body.query.trim() : ""

    if (!query) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Field 'query' is required and must be a non-empty string" }))
      return
    }

    const topN = typeof body.topN === "number" && Number.isFinite(body.topN) ? Math.round(body.topN) : 5

    const recommender = new TemplateRecommender(registry)
    const recommendations = recommender.recommend(query, topN)

    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ recommendations }))
  }
}
