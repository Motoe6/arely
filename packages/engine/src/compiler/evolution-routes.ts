import type { IncomingMessage, ServerResponse } from "node:http"
import { ulid } from "ulid"
import type { CompilerLLMAdapter } from "@arelyos/flow-ai-compiler"
import type { Router } from "../transport/router.js"
import type { SSEBus } from "../server/sse.js"
import type { TemplateRegistry } from "../templates/template-registry.js"
import { evolveWorkflow } from "../templates/evolution-engine.js"
import type { WorkflowEvolvedEvent, FeedbackSubmittedEvent, TemplateEvolvedEvent, EvolutionProposalCreatedEvent, EvolutionProposalApprovedEvent, EvolutionProposalRejectedEvent } from "../types/events.js"
import { listAudit, getAuditByTemplate, getAuditByProposal } from "../persistence/evolution-audit-store.js"
import { StructuralInsightsService } from "../structural/structural-insights-service.js"
import { StructuralEvolutionProposalService } from "../structural/structural-evolution-proposal-service.js"
import { StructuralProposalService } from "../structural/structural-proposal-service.js"
import { StructuralEvolutionService } from "../structural/structural-evolution-service.js"
import type { CreateFeedbackInput } from "../persistence/feedback-store.js"
import { createFeedback, getFeedbackByWorkflow, getTemplateMetrics, getFeedbackStats } from "../persistence/feedback-store.js"
import { createProposal, listProposals, getProposal, updateProposalStatus } from "../persistence/proposal-store.js"
import type { CreateProposalInput } from "../persistence/proposal-store.js"
import { ParameterEffectivenessService } from "../templates/parameter-effectiveness.js"
import { ParameterRecommenderService } from "../templates/parameter-recommender.js"
import { EvolutionProposalService } from "../evolution/evolution-proposal-service.js"
import { TemplateEvolutionService } from "../evolution/template-evolution-service.js"

function handleEvolve(registry: TemplateRegistry, adapter: CompilerLLMAdapter, sse?: SSEBus) {
  return async (req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): Promise<void> => {
    const body = (req as unknown as { body?: Record<string, unknown> }).body
    const query = body?.query

    if (!query || typeof query !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Missing or invalid 'query' field" }))
      return
    }

    try {
      const result = await evolveWorkflow({ query, registry, adapter })

      if (result.success && sse) {
        const event: WorkflowEvolvedEvent = {
          id: ulid(),
          version: 1 as const,
          timestamp: Date.now(),
          type: "workflow_evolved",
          workflowId: result.workflow!.id!,
          templateId: result.templateId!,
          templateName: result.templateName!,
          adaptedParams: result.adaptedParams ?? {},
          diagnostics: result.diagnostics,
        }
        sse.emitSystem(event)
      }

      res.writeHead(result.success ? 200 : 422, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        success: false,
        diagnostics: [{
          phase: "recommendation",
          kind: "error",
          message: `Evolution failed: ${err}`,
        }],
      }))
    }
  }
}

function handleSubmitFeedback(sse?: SSEBus) {
  return (req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    const body = (req as unknown as { body?: Record<string, unknown> }).body

    if (!body || !body.workflowId || typeof body.workflowId !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Missing or invalid 'workflowId' field" }))
      return
    }
    if (!body.source || typeof body.source !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Missing or invalid 'source' field" }))
      return
    }
    if (typeof body.success !== "boolean") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Missing or invalid 'success' field (must be boolean)" }))
      return
    }

    const validSources = ["evolved", "template", "manual", "imported"]
    if (!validSources.includes(body.source as string)) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Invalid source. Must be one of: ${validSources.join(", ")}` }))
      return
    }

    try {
      const rawParams = body.parameters
      const parameters: Record<string, string> | null =
        rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)
          ? Object.fromEntries(
              Object.entries(rawParams as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
            )
          : null

      const input: CreateFeedbackInput = {
        workflowId: body.workflowId as string,
        workflowVersionId: body.workflowVersionId as string | undefined ?? null,
        templateId: body.templateId as string | undefined ?? null,
        source: body.source as "evolved" | "template" | "manual" | "imported",
        success: body.success as boolean,
        durationMs: typeof body.durationMs === "number" ? body.durationMs : null,
        parameters,
      }

      const record = createFeedback(input)

      if (sse) {
        const event: FeedbackSubmittedEvent = {
          id: ulid(),
          version: 1 as const,
          timestamp: Date.now(),
          type: "feedback_submitted",
          workflowId: record.workflowId,
          templateId: record.templateId ?? undefined,
          source: record.source,
          success: record.success,
        }
        sse.emitSystem(event)
      }

      res.writeHead(201, { "Content-Type": "application/json" })
      res.end(JSON.stringify(record))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to submit feedback: ${err}` }))
    }
  }
}

function handleListWorkflowFeedback() {
  return (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const workflowId = params.id
      if (!workflowId) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing workflow id" }))
        return
      }
      const records = getFeedbackByWorkflow(workflowId)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(records))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to list feedback: ${err}` }))
    }
  }
}

function handleGetTemplateMetrics() {
  return (_req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    try {
      const metrics = getTemplateMetrics()
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(metrics))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to get metrics: ${err}` }))
    }
  }
}

function handleGetFeedbackStats() {
  return (_req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    try {
      const stats = getFeedbackStats()
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(stats))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to get stats: ${err}` }))
    }
  }
}

function handleGetParameterInsights() {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const templateId = params.templateId
      if (!templateId) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing templateId" }))
        return
      }
      const svc = new ParameterEffectivenessService()
      const insights = svc.getInsights(templateId)
      if (insights.parameters.length === 0) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "No parameter feedback found for this template" }))
        return
      }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(insights))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to get parameter insights: ${err}` }))
    }
  }
}

function handleGetParameterRecommendations() {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const templateId = params.templateId
      if (!templateId) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing templateId" }))
        return
      }
      const svc = new ParameterRecommenderService()
      const result = svc.getRecommendations(templateId)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to get parameter recommendations: ${err}` }))
    }
  }
}

function handleCreateProposal(sse?: SSEBus) {
  return (req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    const body = (req as unknown as { body?: Record<string, unknown> }).body

    if (!body || !body.templateId || typeof body.templateId !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Missing or invalid 'templateId' field" }))
      return
    }
    if (!body.parameter || typeof body.parameter !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Missing or invalid 'parameter' field" }))
      return
    }
    if (typeof body.confidence !== "number") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Missing or invalid 'confidence' field (must be number)" }))
      return
    }
    if (!body.evidence || typeof body.evidence !== "object") {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Missing or invalid 'evidence' field" }))
      return
    }

    const validTypes = ["parameter_change", "parameter_removal", "parameter_addition"]
    if (!validTypes.includes(body.type as string)) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` }))
      return
    }

    try {
      const input: CreateProposalInput = {
        templateId: body.templateId as string,
        type: body.type as "parameter_change" | "parameter_removal" | "parameter_addition",
        parameter: body.parameter as string,
        currentValue: body.currentValue as string | undefined ?? null,
        suggestedValue: body.suggestedValue as string | undefined ?? null,
        confidence: body.confidence as number,
        evidence: body.evidence as { executions: number; successRate: number },
      }
      const record = createProposal(input)

      if (sse) {
        const event: EvolutionProposalCreatedEvent = {
          id: ulid(),
          version: 1 as const,
          timestamp: Date.now(),
          type: "evolution_proposal_created",
          proposalId: record.id,
          templateId: record.templateId,
          parameter: record.parameter,
          confidence: record.confidence,
        }
        sse.emitSystem(event)
      }

      res.writeHead(201, { "Content-Type": "application/json" })
      res.end(JSON.stringify(record))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to create proposal: ${err}` }))
    }
  }
}

function handleListProposals() {
  return (req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost")
      const status = url.searchParams.get("status") ?? undefined
      const templateId = url.searchParams.get("templateId") ?? undefined
      const result = listProposals({ status: status as any, templateId })
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to list proposals: ${err}` }))
    }
  }
}

function handleGetProposal() {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const id = params.id
      if (!id) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing proposal id" }))
        return
      }
      const record = getProposal(id)
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Proposal not found" }))
        return
      }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(record))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to get proposal: ${err}` }))
    }
  }
}

function handleApproveProposal(sse?: SSEBus) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const id = params.id
      if (!id) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing proposal id" }))
        return
      }
      const record = updateProposalStatus(id, "approved")
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Proposal not found" }))
        return
      }

      if (sse) {
        const event: EvolutionProposalApprovedEvent = {
          id: ulid(),
          version: 1 as const,
          timestamp: Date.now(),
          type: "evolution_proposal_approved",
          proposalId: record.id,
          templateId: record.templateId,
          parameter: record.parameter,
        }
        sse.emitSystem(event)
      }

      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(record))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to approve proposal: ${err}` }))
    }
  }
}

function handleRejectProposal(sse?: SSEBus) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const id = params.id
      if (!id) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing proposal id" }))
        return
      }
      const record = updateProposalStatus(id, "rejected")
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Proposal not found" }))
        return
      }

      if (sse) {
        const event: EvolutionProposalRejectedEvent = {
          id: ulid(),
          version: 1 as const,
          timestamp: Date.now(),
          type: "evolution_proposal_rejected",
          proposalId: record.id,
          templateId: record.templateId,
          parameter: record.parameter,
        }
        sse.emitSystem(event)
      }

      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(record))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to reject proposal: ${err}` }))
    }
  }
}

function handleApplyProposal(registry: TemplateRegistry, sse?: SSEBus) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const id = params.id
      if (!id) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing proposal id" }))
        return
      }
      const svc = new TemplateEvolutionService(registry)
      const result = svc.applyProposal(id)

      if (sse) {
        const event: TemplateEvolvedEvent = {
          id: ulid(),
          version: 1 as const,
          timestamp: Date.now(),
          type: "template_evolved",
          templateId: result.templateId,
          proposalId: result.proposalId,
          oldVersion: result.oldVersion,
          newVersion: result.newVersion,
          parameter: result.parameter,
          oldValue: result.oldValue,
          newValue: result.newValue,
        }
        sse.emitSystem(event)
      }

      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
    } catch (err) {
      const status = err instanceof Error && err.name === "TemplateEvolutionError" ? 422 : 500
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to apply proposal: ${err}` }))
    }
  }
}

function handleCreateStructuralProposal(registry: TemplateRegistry, sse?: SSEBus) {
  return (req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    try {
      const body = (req as unknown as { body?: Record<string, unknown> }).body
      const templateId = body?.templateId as string | undefined
      if (!templateId) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing required field: templateId" }))
        return
      }
      const svc = new StructuralEvolutionProposalService(registry)
      const proposals = svc.getProposals(templateId)
      if (proposals.length === 0) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "No structural proposals generated for this template" }))
        return
      }
      const propSvc = new StructuralProposalService()
      const records = proposals.map((p) => propSvc.persist(p))

      if (sse) {
        for (const record of records) {
          const event: EvolutionProposalCreatedEvent = {
            id: ulid(), version: 1, timestamp: Date.now(),
            type: "evolution_proposal_created",
            proposalId: record.id,
            templateId: record.templateId,
            parameter: record.parameter,
            confidence: record.confidence,
          }
          sse.emitSystem(event)
        }
      }

      res.writeHead(201, { "Content-Type": "application/json" })
      res.end(JSON.stringify(records))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to create structural proposal: ${err}` }))
    }
  }
}

function handleListStructuralProposals() {
  return (_req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    try {
      const svc = new StructuralProposalService()
      const records = svc.list()
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(records))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to list structural proposals: ${err}` }))
    }
  }
}

function handleGetStructuralProposal() {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const svc = new StructuralProposalService()
      const record = svc.get(params.id)
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Structural proposal not found" }))
        return
      }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(record))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to get structural proposal: ${err}` }))
    }
  }
}

function handleApproveStructuralProposal(sse?: SSEBus) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const svc = new StructuralProposalService()
      const record = svc.approve(params.id)
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Structural proposal not found" }))
        return
      }
      if (sse) {
        const event: EvolutionProposalApprovedEvent = {
          id: ulid(), version: 1, timestamp: Date.now(),
          type: "evolution_proposal_approved",
          proposalId: record.id,
          templateId: record.templateId,
          parameter: record.parameter,
        }
        sse.emitSystem(event)
      }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(record))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to approve structural proposal: ${err}` }))
    }
  }
}

function handleRejectStructuralProposal(sse?: SSEBus) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const svc = new StructuralProposalService()
      const record = svc.reject(params.id)
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Structural proposal not found" }))
        return
      }
      if (sse) {
        const event: EvolutionProposalRejectedEvent = {
          id: ulid(), version: 1, timestamp: Date.now(),
          type: "evolution_proposal_rejected",
          proposalId: record.id,
          templateId: record.templateId,
          parameter: record.parameter,
        }
        sse.emitSystem(event)
      }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(record))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to reject structural proposal: ${err}` }))
    }
  }
}

function handleApplyStructuralProposal(registry: TemplateRegistry, sse?: SSEBus) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const id = params.id
      if (!id) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing proposal id" }))
        return
      }
      const svc = new StructuralEvolutionService(registry)
      const result = svc.applyProposal(id)

      if (sse) {
        const event: TemplateEvolvedEvent = {
          id: ulid(),
          version: 1 as const,
          timestamp: Date.now(),
          type: "template_evolved",
          templateId: result.templateId,
          proposalId: result.proposalId,
          oldVersion: result.oldVersion,
          newVersion: result.newVersion,
          parameter: result.kind,
          oldValue: result.changes,
          newValue: result.changes,
        }
        sse.emitSystem(event)
      }

      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
    } catch (err) {
      const status = err instanceof Error && err.name === "StructuralEvolutionError" ? 422 : 500
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to apply structural proposal: ${err}` }))
    }
  }
}

function handleStructuralListAudit() {
  return (req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost")
      const templateId = url.searchParams.get("templateId") ?? undefined
      const limit = parseInt(url.searchParams.get("limit") ?? "50", 10)
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10)
      const result = listAudit({ templateId, limit, offset })
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to list structural audit records: ${err}` }))
    }
  }
}

function handleStructuralGetTemplateAudit() {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const templateId = params.templateId
      if (!templateId) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing templateId" }))
        return
      }
      const url = new URL(_req.url ?? "/", "http://localhost")
      const limit = parseInt(url.searchParams.get("limit") ?? "50", 10)
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10)
      const result = getAuditByTemplate(templateId, { limit, offset })
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to get template audit: ${err}` }))
    }
  }
}

function handleStructuralGetProposalAudit() {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const proposalId = params.proposalId
      if (!proposalId) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing proposalId" }))
        return
      }
      const record = getAuditByProposal(proposalId)
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Audit record not found for this proposal" }))
        return
      }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(record))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to get proposal audit: ${err}` }))
    }
  }
}

function handleGetStructuralProposals(registry: TemplateRegistry) {
  return (_req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    try {
      const svc = new StructuralEvolutionProposalService(registry)
      const proposals = svc.getProposals()
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(proposals))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to get structural proposals: ${err}` }))
    }
  }
}

function handleGetStructuralProposalsByTemplate(registry: TemplateRegistry) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const svc = new StructuralEvolutionProposalService(registry)
      const proposals = svc.getProposals(params.templateId)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(proposals))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to get structural proposals: ${err}` }))
    }
  }
}

function handleGetStructuralInsights(registry: TemplateRegistry) {
  return (_req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    try {
      const svc = new StructuralInsightsService(registry)
      const result = svc.getInsights()
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to get structural insights: ${err}` }))
    }
  }
}

function handleGetEvolutionProposals(recommender: ParameterRecommenderService, effectivenessService: ParameterEffectivenessService) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const templateId = params.templateId
      if (!templateId) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing templateId" }))
        return
      }
      const svc = new EvolutionProposalService(recommender, effectivenessService)
      const result = svc.getProposals(templateId)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to get evolution proposals: ${err}` }))
    }
  }
}

function handleListAudit() {
  return (req: IncomingMessage, res: ServerResponse, _params: Record<string, string>): void => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost")
      const templateId = url.searchParams.get("templateId") ?? undefined
      const limit = parseInt(url.searchParams.get("limit") ?? "50", 10)
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10)
      const result = listAudit({ templateId, limit, offset })
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to list audit records: ${err}` }))
    }
  }
}

function handleGetTemplateAudit() {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const templateId = params.templateId
      if (!templateId) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing templateId" }))
        return
      }
      const url = new URL(_req.url ?? "/", "http://localhost")
      const limit = parseInt(url.searchParams.get("limit") ?? "50", 10)
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10)
      const result = getAuditByTemplate(templateId, { limit, offset })
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to get template audit: ${err}` }))
    }
  }
}

function handleGetProposalAudit() {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    try {
      const proposalId = params.proposalId
      if (!proposalId) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing proposalId" }))
        return
      }
      const record = getAuditByProposal(proposalId)
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Audit record not found for this proposal" }))
        return
      }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(record))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: `Failed to get proposal audit: ${err}` }))
    }
  }
}

export function registerEvolutionRoutes(
  router: Router,
  registry: TemplateRegistry,
  adapter: CompilerLLMAdapter,
  sse?: SSEBus,
  _metricsService?: TemplateMetricsService,
): void {
  const recommender = new ParameterRecommenderService()
  const effectivenessService = new ParameterEffectivenessService()

  router.post("/api/flow/workflows/evolve", handleEvolve(registry, adapter, sse))
  router.post("/api/flow/workflows/:id/feedback", handleSubmitFeedback(sse))
  router.get("/api/flow/workflows/:id/feedback", handleListWorkflowFeedback())
  router.get("/api/flow/metrics/templates", handleGetTemplateMetrics())
  router.get("/api/flow/metrics/templates/:templateId/parameters", handleGetParameterInsights())
  router.get("/api/flow/metrics/templates/:templateId/parameter-recommendations", handleGetParameterRecommendations())
  router.get("/api/flow/metrics/templates/:templateId/evolution-proposals", handleGetEvolutionProposals(recommender, effectivenessService))
  router.get("/api/flow/evolution/proposals", handleListProposals())
  router.post("/api/flow/evolution/proposals", handleCreateProposal(sse))
  router.get("/api/flow/evolution/proposals/:id", handleGetProposal())
  router.post("/api/flow/evolution/proposals/:id/approve", handleApproveProposal(sse))
  router.post("/api/flow/evolution/proposals/:id/reject", handleRejectProposal(sse))
  router.post("/api/flow/evolution/proposals/:id/apply", handleApplyProposal(registry, sse))
  router.get("/api/flow/evolution/audit", handleListAudit())
  router.get("/api/flow/evolution/audit/template/:templateId", handleGetTemplateAudit())
  router.get("/api/flow/evolution/audit/proposal/:proposalId", handleGetProposalAudit())
  router.get("/api/flow/structural/insights", handleGetStructuralInsights(registry))
  router.get("/api/flow/structural/proposals/ephemeral", handleGetStructuralProposals(registry))
  router.get("/api/flow/structural/proposals/ephemeral/:templateId", handleGetStructuralProposalsByTemplate(registry))
  router.post("/api/flow/structural/proposals", handleCreateStructuralProposal(registry, sse))
  router.get("/api/flow/structural/proposals", handleListStructuralProposals())
  router.get("/api/flow/structural/proposals/:id", handleGetStructuralProposal())
  router.post("/api/flow/structural/proposals/:id/approve", handleApproveStructuralProposal(sse))
  router.post("/api/flow/structural/proposals/:id/reject", handleRejectStructuralProposal(sse))
  router.post("/api/flow/structural/proposals/:id/apply", handleApplyStructuralProposal(registry, sse))
  router.get("/api/flow/structural/audit", handleStructuralListAudit())
  router.get("/api/flow/structural/audit/template/:templateId", handleStructuralGetTemplateAudit())
  router.get("/api/flow/structural/audit/proposal/:proposalId", handleStructuralGetProposalAudit())
  router.get("/api/flow/metrics/feedback", handleGetFeedbackStats())
}
