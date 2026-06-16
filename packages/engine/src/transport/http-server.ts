import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Router } from "./router.js";
import { SSEBus } from "../server/sse.js";
import { getDb } from "../persistence/database.js";
import { getConfig } from "../config/index.js";
import { metrics } from "../metrics.js";
import { tracer } from "../tracer.js";
import { getEventsAfter } from "../persistence/event-store.js";
import { getTrace, listTraces, countTraces } from "../persistence/policy-audit-store.js";
import { SimulationEngine } from "../agents/simulation/simulation-engine.js";
import { FileSystemPolicyPackStore } from "../agents/policy/policy-pack.js";
import { PolicyRecommender, type RecommenderAuditPort } from "../agents/policy/policy-recommender.js";
import { ImpactAnalyzer } from "../agents/policy/impact-analyzer.js";
import type { PolicyRule } from "../agents/policy/policy-types.js";
import type { HealthRegistry } from "../health.js";
import type { Middleware } from "./middleware.js";
import { renderDashboardPage } from "../ui/dashboard.js";
import { renderSwarmPage } from "../ui/swarm-viz.js";
import { PolicyChangeService, ChangeServiceError } from "../control/policy-change-service.js";

export interface HttpServerOptions {
  sse: SSEBus;
  port?: number;
  setupRoutes?: (router: Router) => void;
  middleware?: Middleware[];
  healthRegistry?: HealthRegistry;
}

function getLabelPath(urlPath: string): string {
  if (urlPath.startsWith("/api/sse")) return "/api/sse";
  if (urlPath.startsWith("/api/")) return "/api/*";
  return urlPath;
}

export function createHttpServer(opts: HttpServerOptions): ReturnType<typeof createServer> {
  const { sse, port = 8081, setupRoutes, middleware = [], healthRegistry } = opts;
  const router = new Router();
  const cfg = getConfig();
  const simulationEngine = new SimulationEngine({ getTrace });
  const packStore = new FileSystemPolicyPackStore(cfg.POLICY_PACKS_DIR);
  const recommenderAuditPort: RecommenderAuditPort = {
    listTraces: (limit, offset) => listTraces(limit, offset),
    countTraces: () => countTraces(),
    getTrace: (traceId) => getTrace(traceId),
  };
  const recommender = new PolicyRecommender(packStore, recommenderAuditPort);
  const impactAnalyzer = new ImpactAnalyzer(packStore, simulationEngine, { listTraces });
  const changeService = new PolicyChangeService(packStore);

  for (const mw of middleware) {
    router.use(mw);
  }

  router.get("/api/sse", (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const sessionId = url.searchParams.get("sessionId") ?? "default";
    const lastEventId = req.headers["last-event-id"] as string | undefined;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    sse.addClient(sessionId, res, lastEventId);
  });

  router.get("/api/sse/replay", (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const sessionId = url.searchParams.get("sessionId") ?? "default";
    const lastSeq = Number(url.searchParams.get("lastSeq") ?? "0");

    const cfg = getConfig();
    const maxBatch = cfg.MAX_REPLAY_BATCH_SIZE;
    const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, maxBatch)
      : cfg.DEFAULT_REPLAY_BATCH_SIZE;

    const events = getEventsAfter(sessionId, lastSeq, limit);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sessionId, lastSeq, count: events.length, events, limit }));
  });

  router.get("/health", (_req: IncomingMessage, res: ServerResponse) => {
    if (healthRegistry) {
      const status = healthRegistry.getStatus();
      res.writeHead(status.ok ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: status.ok, uptime: process.uptime(), checks: status.checks }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
    }
  });

  router.get("/ready", (_req: IncomingMessage, res: ServerResponse) => {
    if (healthRegistry) {
      const status = healthRegistry.getStatus();
      res.writeHead(status.ok ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: status.ok, uptime: process.uptime() }));
    } else {
      try {
        getDb();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, db: true }));
      } catch {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, db: false }));
      }
    }
  });

  router.get("/metrics", (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(metrics.prometheusExport());
  });

  router.get("/traces", (_req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(_req.url ?? "/", `http://${_req.headers.host ?? "localhost"}`);
    const traceId = url.searchParams.get("traceId");
    if (traceId) {
      const trace = tracer.getTrace(traceId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(trace));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ traceIds: tracer.getAllTraceIds() }));
    }
  });

  router.get("/audit", (_req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(_req.url ?? "/", `http://${_req.headers.host ?? "localhost"}`);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 100);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);
    const traces = listTraces(limit, offset);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ traces, total: countTraces(), limit, offset }));
  });

  router.get("/audit/:traceId", (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const traceId = params.traceId;
    if (!traceId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "traceId required" }));
      return;
    }
    const events = getTrace(traceId);
    if (events.length === 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "trace not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ traceId, events, eventCount: events.length }));
  });

  router.post("/audit/:traceId/replay", (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const traceId = params.traceId;
    const body = (_req as unknown as { body?: string }).body ?? "{}";
    let parsedReq: { rules?: PolicyRule[] };
    try {
      parsedReq = JSON.parse(body) as { rules?: PolicyRule[] };
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }

    const rules = parsedReq.rules;
    if (!rules || !Array.isArray(rules) || rules.length === 0) {
      const events = getTrace(traceId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        traceId,
        historicalEvents: events,
        message: "No rules provided — returning historical context. POST with { rules: [...] } to re-evaluate.",
      }));
      return;
    }

    try {
      const result = simulationEngine.simulateTrace(traceId, rules);
      if (result.error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error, traceId }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  router.post("/simulate", (_req: IncomingMessage, res: ServerResponse) => {
    const body = (_req as unknown as { body?: string }).body ?? "{}";
    let parsedReq: { traceIds?: string[]; rules?: PolicyRule[]; packId?: string };
    try {
      parsedReq = JSON.parse(body) as { traceIds?: string[]; rules?: PolicyRule[]; packId?: string };
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }

    const { traceIds, rules, packId } = parsedReq;
    if (!traceIds || !Array.isArray(traceIds) || traceIds.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "traceIds array is required" }));
      return;
    }

    let resolvedRules: PolicyRule[] | undefined = rules;
    if (!resolvedRules && packId) {
      const pack = packStore.get(packId);
      if (!pack) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `pack '${packId}' not found` }));
        return;
      }
      resolvedRules = pack.rules;
    }

    if (!resolvedRules || resolvedRules.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "rules array or packId is required" }));
      return;
    }

    try {
      const result = simulationEngine.simulateBatch(traceIds, resolvedRules);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  router.get("/packs", (_req: IncomingMessage, res: ServerResponse) => {
    const packs = packStore.list();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ packs, count: packs.length }));
  });

  router.get("/packs/:packId", (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const pack = packStore.get(params.packId);
    if (!pack) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "pack not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(pack));
  });

  router.post("/packs", (_req: IncomingMessage, res: ServerResponse) => {
    const body = (_req as unknown as { body?: string }).body ?? "{}";
    let parsed: { name?: string; description?: string; rules?: PolicyRule[] };
    try {
      parsed = JSON.parse(body) as { name?: string; description?: string; rules?: PolicyRule[] };
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }
    if (!parsed.name || !parsed.rules || !Array.isArray(parsed.rules) || parsed.rules.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "name and rules[] are required" }));
      return;
    }
    const pack = packStore.create({
      name: parsed.name,
      description: parsed.description ?? "",
      rules: parsed.rules,
    });
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(pack));
  });

  router.put("/packs/:packId", (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const body = (_req as unknown as { body?: string }).body ?? "{}";
    let parsed: { name?: string; description?: string; rules?: PolicyRule[] };
    try {
      parsed = JSON.parse(body) as { name?: string; description?: string; rules?: PolicyRule[] };
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }
    const pack = packStore.update(params.packId, parsed);
    if (!pack) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "pack not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(pack));
  });

  router.delete("/packs/:packId", (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const deleted = packStore.delete(params.packId);
    if (!deleted) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "pack not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ deleted: true }));
  });

  router.get("/recommendations", (_req: IncomingMessage, res: ServerResponse) => {
    const recs = recommender.analyzeAll();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ recommendations: recs, count: recs.length }));
  });

  router.get("/recommendations/:packId", (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const recs = recommender.analyzePack(params.packId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ recommendations: recs, count: recs.length }));
  });

  router.post("/recommendations/:packId/validate", (_req: IncomingMessage, res: ServerResponse, _params: Record<string, string>) => {
    const body = (_req as unknown as { body?: string }).body ?? "{}";
    let parsed: { recommendation?: unknown; traceIds?: string[] };
    try {
      parsed = JSON.parse(body) as { recommendation?: unknown; traceIds?: string[] };
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }
    if (!parsed.recommendation) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "recommendation is required" }));
      return;
    }
    const impact = impactAnalyzer.validate(parsed.recommendation as import("../agents/policy/policy-recommender.js").PolicyRecommendation, parsed.traceIds);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ impact }));
  });

  router.get("/deps", (_req: IncomingMessage, res: ServerResponse) => {
    if (healthRegistry) {
      const status = healthRegistry.getStatus();
      const detail: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};
      for (const check of status.checks) {
        detail[check.name] = { ok: check.ok, latencyMs: check.latencyMs, error: check.error };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: status.ok, ...detail }));
    } else {
      let dbOk = false;
      let dbLatencyMs = -1;
      try {
        const start = Date.now();
        getDb();
        dbLatencyMs = Date.now() - start;
        dbOk = true;
      } catch {
        dbOk = false;
      }

      const config = getConfig();
      const llmOk = Boolean(config.ARELY_BASE_URL && config.ARELY_API_KEY);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          db: { ok: dbOk, latencyMs: dbLatencyMs },
          llm: { ok: llmOk, baseUrl: config.ARELY_BASE_URL, model: config.ARELY_MODEL },
          search: { provider: config.ARELY_WEBSEARCH_PROVIDER },
        }),
      );
    }
  });

  // ─── M10.1 Control Plane ───

  router.get("/control/status", (_req: IncomingMessage, res: ServerResponse) => {
    let dbOk = false;
    try { getDb(); dbOk = true; } catch { /* not connected */ }
    const packs = packStore.list().length;
    const traces = countTraces();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: dbOk,
      uptime: process.uptime(),
      packs,
      traces,
      recommendationsEnabled: true,
      simulationEnabled: true,
    }));
  });

  router.get("/control/packs", (_req: IncomingMessage, res: ServerResponse) => {
    const packs = packStore.list();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ packs, count: packs.length }));
  });

  router.get("/control/audit", (_req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(_req.url ?? "/", `http://${_req.headers.host ?? "localhost"}`);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 100);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);
    const traces = listTraces(limit, offset);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ traces, total: countTraces(), limit, offset }));
  });

  router.get("/control/recommendations", (_req: IncomingMessage, res: ServerResponse) => {
    const recs = recommender.analyzeAll();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ recommendations: recs, count: recs.length }));
  });

  router.post("/control/analyze", (_req: IncomingMessage, res: ServerResponse) => {
    const body = (_req as unknown as { body?: string }).body ?? "{}";
    let parsed: { packId?: string };
    try {
      parsed = JSON.parse(body) as { packId?: string };
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }
    if (!parsed.packId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "packId is required" }));
      return;
    }

    const start = Date.now();
    const controlTraceId = `control-analyze-${start}`;
    const rootSpan = tracer.startSpan(controlTraceId, "control.analyze");

    try {
      const recSpan = tracer.startSpan(controlTraceId, "control.analyze.recommendations", rootSpan.spanId);
      const recommendations = recommender.analyzePack(parsed.packId);
      tracer.endSpan(recSpan, { count: recommendations.length });

      const valSpan = tracer.startSpan(controlTraceId, "control.analyze.validation", rootSpan.spanId);
      const reports = impactAnalyzer.validateAll(recommendations);
      tracer.endSpan(valSpan, { count: reports.length });

      const scores = reports.map((r) => r.impactScore);
      const total = reports.length;
      const critical = reports.filter((r) => r.impactScore >= 0.7).length;
      const high = reports.filter((r) => r.impactScore >= 0.4 && r.impactScore < 0.7).length;
      const medium = reports.filter((r) => r.impactScore >= 0.1 && r.impactScore < 0.4).length;
      const low = reports.filter((r) => r.impactScore < 0.1).length;
      const averageImpactScore = total > 0 ? scores.reduce((s, v) => s + v, 0) / total : 0;
      const maxImpactScore = total > 0 ? Math.max(...scores) : 0;

      const durationMs = Date.now() - start;
      metrics.observeDuration("control_analyze_duration_ms", {}, durationMs);

      tracer.endSpan(rootSpan, { durationMs, recommendations: recommendations.length, validated: reports.length });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        packId: parsed.packId,
        recommendations,
        validatedRecommendations: reports,
        summary: { critical, high, medium, low, total, averageImpactScore, maxImpactScore },
      }));
    } catch (err) {
      tracer.endSpan(rootSpan, {}, String(err));
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  router.post("/control/pipeline", (_req: IncomingMessage, res: ServerResponse) => {
    const body = (_req as unknown as { body?: string }).body ?? "{}";
    let parsed: { packId?: string; traceIds?: string[] };
    try {
      parsed = JSON.parse(body) as { packId?: string; traceIds?: string[] };
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }
    if (!parsed.packId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "packId is required" }));
      return;
    }

    const start = Date.now();
    const controlTraceId = `control-pipeline-${start}`;
    const rootSpan = tracer.startSpan(controlTraceId, "control.pipeline");

    try {
      const pack = packStore.get(parsed.packId);
      if (!pack) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `pack '${parsed.packId}' not found` }));
        return;
      }

      const ids = parsed.traceIds ?? listTraces(100, 0).map((s) => s.traceId);
      if (ids.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "no traces available" }));
        return;
      }

      const simSpan = tracer.startSpan(controlTraceId, "control.pipeline.simulation", rootSpan.spanId);
      const simulation = simulationEngine.simulateBatch(ids, pack.rules);
      tracer.endSpan(simSpan, { tracesSucceeded: simulation.tracesSucceeded });

      const recSpan = tracer.startSpan(controlTraceId, "control.pipeline.recommendations", rootSpan.spanId);
      const recommendations = recommender.analyzePack(parsed.packId);
      tracer.endSpan(recSpan, { count: recommendations.length });

      const valSpan = tracer.startSpan(controlTraceId, "control.pipeline.validation", rootSpan.spanId);
      const reports = recommendations.map((r) => impactAnalyzer.validate(r, ids));
      tracer.endSpan(valSpan, { count: reports.length });

      const durationMs = Date.now() - start;
      metrics.observeDuration("control_pipeline_duration_ms", {}, durationMs);

      tracer.endSpan(rootSpan, { durationMs, tracesRequested: ids.length, recommendations: recommendations.length });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        packId: parsed.packId,
        pack: { name: pack.name, rules: pack.rules.length },
        simulation,
        recommendations,
        impactReports: reports,
        meta: {
          tracesRequested: simulation.tracesRequested,
          tracesSucceeded: simulation.tracesSucceeded,
          tracesFailed: simulation.tracesFailed,
          generatedAt: new Date().toISOString(),
          durationMs,
        },
      }));
    } catch (err) {
      tracer.endSpan(rootSpan, {}, String(err));
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  // ─── F36 Change Management ───

  router.post("/control/change/create", (_req: IncomingMessage, res: ServerResponse) => {
    const body = (_req as unknown as { body?: string }).body ?? "{}";
    let parsed: { packId?: string; rules?: unknown[]; name?: string; description?: string; recommendationIds?: string[] };
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }
    if (!parsed.packId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "packId required" }));
      return;
    }
    try {
      const change = changeService.createChange({
        packId: parsed.packId,
        proposedRules: (parsed.rules ?? []) as never[],
        proposedName: parsed.name,
        proposedDescription: parsed.description,
        recommendationIds: parsed.recommendationIds,
      });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(change));
    } catch (err) {
      const code = err instanceof ChangeServiceError ? err.code : "UNKNOWN";
      const status = code === "PACK_NOT_FOUND" ? 404 : 400;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err), code }));
    }
  });

  router.post("/control/change/:id/approve", (_req: IncomingMessage, res: ServerResponse, params) => {
    try {
      const change = changeService.approveChange(params.id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(change));
    } catch (err) {
      const code = err instanceof ChangeServiceError ? err.code : "UNKNOWN";
      const status = code === "CHANGE_NOT_FOUND" ? 404 : 409;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err), code }));
    }
  });

  router.post("/control/change/:id/apply", (_req: IncomingMessage, res: ServerResponse, params) => {
    try {
      const change = changeService.applyChange(params.id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(change));
    } catch (err) {
      const code = err instanceof ChangeServiceError ? err.code : "UNKNOWN";
      const status = code === "CHANGE_NOT_FOUND" ? 404 : 409;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err), code }));
    }
  });

  router.get("/control/change/:id", (_req: IncomingMessage, res: ServerResponse, params) => {
    const change = changeService.getChange(params.id);
    if (!change) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Change not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(change));
  });

  router.get("/control/changes", (_req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(_req.url ?? "/", `http://${_req.headers.host ?? "localhost"}`);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
    const changes = changeService.listChanges(limit, offset);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ changes }));
  });

  // ─── M10.2 Dashboard ───

  router.get("/dashboard", (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(renderDashboardPage());
  });

  router.get("/swarm", (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(renderSwarmPage());
  });

  if (setupRoutes) {
    setupRoutes(router);
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const start = Date.now();
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const labelPath = getLabelPath(url.pathname);

    const originalEnd = res.end.bind(res);
    res.end = function (...args: Parameters<ServerResponse["end"]>) {
      const durationMs = Date.now() - start;
      metrics.observeDuration("http_request_duration_ms", {
        method: req.method ?? "GET",
        path: labelPath,
        status: String(res.statusCode),
      }, durationMs);
      return originalEnd(...args);
    } as ServerResponse["end"];

    router.dispatch(req, res);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} in use`);
    } else {
      console.error(`Server error: ${err.message}`);
    }
  });

  return server;
}
