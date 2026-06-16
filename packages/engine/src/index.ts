#!/usr/bin/env node
import { loadConfig } from "./config/index.js";
import { connect } from "./persistence/database.js";
import { pushSchema } from "./persistence/migrate.js";
import { SSEBus } from "./server/sse.js";
import { createHttpServer } from "./transport/http-server.js";
import { SessionManager } from "./server/session-manager.js";
import { registerBuiltInApiProviders, createModel, ProviderBridgeAdapter } from "@arelyos/llm-core";
import { OpenAICompatAdapter } from "./llm/openaicompat.js";
import { ModelRegistry } from "./models/model-registry.js";
import { ModelAwareAdapter } from "./models/model-adapter.js";
import { recoverSessions, emitRecoveryEvents } from "./server/recovery.js";
import { AgentScheduler } from "./agents/scheduler.js";
import { PipelineToolExecutor } from "./agents/pipeline-tool-executor.js";
import { ExecutionReplayer } from "./agents/execution-replayer.js";
import { ExecutionComparator } from "./agents/drift-analyzer.js";
import { createExecutionTracer } from "./agents/execution-tracer.js";
import { getPipelineRun, getPipelineRuns, getPipelineStepRuns } from "./agents/pipeline-store.js";
import { getOverviewMetrics, getToolMetrics, getPipelineMetrics, getErrorMetrics } from "./agents/pipeline-metrics.js";
import { getAllInsights } from "./agents/pipeline-insights.js";
import { generateRemediations } from "./agents/remediation.js";
import { evaluateAlertRules, type Alert } from "./agents/alert-rules.js";
import { PipelineCircuitBreakerRegistry } from "./agents/circuit-breaker-registry.js";
import { createNotifiers, sendAlerts, type AlertNotifier } from "./agents/notifiers/notifier.js";
import { ReliableNotificationService } from "./agents/notifiers/notification-service.js";
import { getNotificationMetrics } from "./agents/notifiers/notification-metrics.js";
import { handleWebhook } from "./agents/triggers/webhook.js";
import { startDrain, isDraining, forceExit } from "./server/shutdown.js";
import { logger } from "./logger.js";
import { metrics } from "./metrics.js";
import { HealthRegistry } from "./health.js";
import { getDb } from "./persistence/database.js";
import { createSearchProvider } from "./tools/provider-factory.js";
import { TemplateRegistry } from "./templates/template-registry.js";
import { registerTemplateRoutes } from "./templates/template-routes.js";
import { BuilderService } from "./compiler/builder-service.js";
import { registerBuilderRoutes } from "./compiler/builder-routes.js";
import { NodePackageLoader } from "./compiler/node-package-loader.js";
import { registerPackageRoutes } from "./compiler/package-routes.js";
import { registerEvolutionRoutes } from "./compiler/evolution-routes.js";
import { TemplateMetricsService } from "./templates/template-metrics.js";
import { listInstalledPackages } from "./compiler/package-store.js";
import { createRemoteAdapter } from "@arelyos/flow-ai-compiler";
import { performWebSearch } from "./tools/websearch.js";
import { performWebFetch } from "./tools/webfetch.js";
import { RedditProvider, formatRedditPosts } from "./tools/reddit.js";
import { fetchRSS, formatRSSEntries } from "./tools/rss.js";
import { agentMemoryGet, agentMemorySet } from "./tools/memory.js";
import { getContextStats, buildContext } from "./llm/context-epoch-service.js";
import { registerGoalRoutes } from "./routes/goal-routes.js";
import { registerSwarmRoutes } from "./routes/swarm-routes.js";
import { memoryService } from "./llm/memory-service.js";
import { memoryRetrievalService } from "./llm/memory-retrieval-service.js";
import { decisionService } from "./llm/decision-service.js";
import {
  requestId,
  cors,
  auth,
  bodyParser,
  requestCounter,
  requestLogger,
  errorHandler,
  requestContext,
} from "./transport/middleware.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { ulid } from "ulid";

export function main() {
  const config = loadConfig();
  registerBuiltInApiProviders();
  connect(config.DB_PATH);

  try {
    pushSchema();
  } catch (err) {
    logger.error("bootstrap", "Schema push failed", { error: err });
    process.exit(1);
  }

  const sse = new SSEBus();
  const sessionManager = new SessionManager();

  const healthRegistry = new HealthRegistry();
  healthRegistry.registerCheck("db", () => {
    try {
      const start = Date.now();
      getDb();
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  healthRegistry.registerCheck("sse", () => ({ ok: true }));
  const modelRegistry = new ModelRegistry(config.ARELY_MODELS, config.ARELY_DEFAULT_MODEL);
  healthRegistry.registerCheck("llm", () => {
    const ok = Boolean(config.ARELY_API_KEY);
    return { ok, error: ok ? undefined : "ARELY_API_KEY not configured" };
  });
  healthRegistry.registerCheck("search", () => ({
    ok: true,
  }));

  logger.info("bootstrap", "Recovering interrupted sessions");
  const recovered = recoverSessions();
  if (recovered.length > 0) {
    emitRecoveryEvents((event) => { sse.emitSystem(event); }, recovered);
  }
  metrics.increment(`sessions.interrupted`, { count: String(recovered.length) });

  const llm = new ModelAwareAdapter(modelRegistry, config.ARELY_API_KEY);

  function toolArg(val: unknown, fallback = ""): string {
    if (typeof val === "string") return val;
    if (val == null) return fallback;
    if (typeof val === "object") return JSON.stringify(val);
    if (typeof val === "symbol") return fallback;
    return val as string;
  }

  const toolHandlers = new Map<string, (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>();
  const searchProvider = createSearchProvider({ ARELY_WEBSEARCH_PROVIDER: config.ARELY_WEBSEARCH_PROVIDER } as Parameters<typeof createSearchProvider>[0]);
  toolHandlers.set("websearch", (args, signal) =>
    performWebSearch(searchProvider, toolArg(args.query), Number(args.numResults ?? 8), signal));
  toolHandlers.set("webfetch", (args, signal) => performWebFetch(toolArg(args.url), signal));
  toolHandlers.set("reddit_hot", async (args, signal) => {
    const reddit = new RedditProvider();
    return formatRedditPosts(await reddit.hot(toolArg(args.subreddit), Number(args.limit ?? 25), signal), toolArg(args.subreddit));
  });
  toolHandlers.set("reddit_search", async (args, signal) => {
    const reddit = new RedditProvider();
    const query = toolArg(args.query);
    const limit = Number(args.limit ?? 25);
    if (args.subreddit) {
      return formatRedditPosts(await reddit.search(toolArg(args.subreddit), query, limit, signal), toolArg(args.subreddit));
    }
    return JSON.stringify(await reddit.globalSearch(query, limit, signal));
  });
  toolHandlers.set("rss_fetch", async (args, signal) => formatRSSEntries(await fetchRSS(toolArg(args.url), Number(args.limit ?? 10), signal)));
  toolHandlers.set("memory_get", (args) => {
    const result = agentMemoryGet("pipeline", toolArg(args.key));
    return Promise.resolve(result ?? `No value found for key "${toolArg(args.key)}".`);
  });
  toolHandlers.set("memory_set", (args) => {
    agentMemorySet("pipeline", toolArg(args.key), toolArg(args.value));
    return Promise.resolve("ok");
  });

  const breakerRegistry = config.AGENT_RUNTIME_ENABLED
    ? new PipelineCircuitBreakerRegistry({
        threshold: config.CIRCUIT_BREAKER_THRESHOLD,
        resetTimeout: config.CIRCUIT_BREAKER_RESET_MS,
        enabled: config.CIRCUIT_BREAKER_ENABLED,
      })
    : undefined;

  const toolExecutor = new PipelineToolExecutor(toolHandlers, {
    timeoutMs: config.TOOL_TIMEOUT_MS,
  }, breakerRegistry);

  const compilerAdapter = createRemoteAdapter({
    endpoint: config.ARELY_BASE_URL,
    apiKey: config.ARELY_API_KEY ?? "",
    model: config.ARELY_MODEL,
    timeoutMs: 30_000,
    provider: "generic",
  })
  const builderService = new BuilderService(compilerAdapter)

  const packageLoader = new NodePackageLoader()

  const templateRegistry = new TemplateRegistry()
  packageLoader.setTemplateRegistry(templateRegistry)
  const TEMPLATES_DIR = fileURLToPath(new URL("../templates", import.meta.url))
  const templateCount = templateRegistry.reloadBuiltins(TEMPLATES_DIR, (entry, err) => {
    logger.warn("templates", `Failed to load template "${entry}"`, { error: err.message })
  })
  logger.info("bootstrap", `Loaded ${templateCount} built-in templates`, {
    metadata: { count: templateCount },
  })
  const USER_TEMPLATES_DIR = config.USER_TEMPLATES_DIR
  const userTemplateCount = templateRegistry.reloadBuiltins(USER_TEMPLATES_DIR, (entry, err) => {
    logger.warn("templates", `Failed to load user template "${entry}"`, { error: err.message })
  }, "user")
  if (userTemplateCount > 0) {
    logger.info("bootstrap", `Loaded ${userTemplateCount} user templates`, {
      metadata: { count: userTemplateCount },
    })
  }

  const runtimeConfig = {
    sessionManager,
    llm,
    executeTool: (toolName: string, args: Record<string, unknown>, ctx?: { stepId?: string; pipelineId?: string }) =>
      toolExecutor.execute(toolName, args, ctx),
  };

  const tracer = config.AGENT_RUNTIME_ENABLED ? createExecutionTracer() : undefined;

  const scheduler = config.AGENT_RUNTIME_ENABLED
    ? new AgentScheduler(runtimeConfig, config.AGENT_SCHEDULER_INTERVAL_MS, tracer)
    : null;
  const emailConfig =
    config.NOTIFY_EMAIL_HOST &&
    config.NOTIFY_EMAIL_AUTH_USER &&
    config.NOTIFY_EMAIL_AUTH_PASS &&
    config.NOTIFY_EMAIL_FROM &&
    config.NOTIFY_EMAIL_TO
      ? {
          host: config.NOTIFY_EMAIL_HOST,
          port: config.NOTIFY_EMAIL_PORT ?? 587,
          secure: config.NOTIFY_EMAIL_SECURE ?? false,
          auth: { user: config.NOTIFY_EMAIL_AUTH_USER, pass: config.NOTIFY_EMAIL_AUTH_PASS },
          from: config.NOTIFY_EMAIL_FROM,
          to: config.NOTIFY_EMAIL_TO,
        }
      : undefined;

  const notifier = config.AGENT_RUNTIME_ENABLED
    ? createNotifiers({
        log: true,
        slackWebhookUrl: config.NOTIFY_SLACK_WEBHOOK_URL,
        discordWebhookUrl: config.NOTIFY_DISCORD_WEBHOOK_URL,
        email: emailConfig,
      })
    : null;

  const notificationService = config.AGENT_RUNTIME_ENABLED
    ? new ReliableNotificationService(notifier, {
        maxRetries: config.NOTIFY_MAX_RETRIES,
        retryBaseDelayMs: config.NOTIFY_RETRY_BASE_DELAY_MS,
        idempotencyWindowS: config.NOTIFY_IDEMPOTENCY_WINDOW_S,
      })
    : null;

  if (scheduler) {
    scheduler.start();
    logger.info("bootstrap", "Agent runtime scheduler started");
  }

  let queueInterval: ReturnType<typeof setInterval> | undefined;
  if (notificationService) {
    queueInterval = setInterval(() => {
      notificationService.processQueue().catch((err) => {
        logger.error("notifier", "Notification queue processing error", { error: String(err) });
      });
    }, config.NOTIFY_QUEUE_POLL_INTERVAL_MS);
    logger.info("bootstrap", "Notification queue processing started", {
      metadata: { intervalMs: config.NOTIFY_QUEUE_POLL_INTERVAL_MS },
    });
  }

  const authExclude = ["/health", "/ready", "/metrics", "/deps", "/api/sse"];
  const logExclude = ["/health", "/metrics"];
  const bodyExclude = ["/health", "/ready", "/metrics", "/deps", "/api/sse", "/api/sse/replay"];

  const counter = requestCounter();

  const middleware = [
    requestId(),
    requestContext(),
    cors(config.HTTP_CORS_ORIGIN),
    auth(config.HTTP_API_AUTH_ENABLED ? config.ARELY_API_KEY : undefined, authExclude),
    bodyParser(config.HTTP_BODY_LIMIT_BYTES, bodyExclude),
    counter.middleware,
    requestLogger({ exclude: logExclude }),
    errorHandler(),
  ];

  const server = createHttpServer({
    sse,
    port: config.PORT,
    middleware,
    healthRegistry,
    setupRoutes: (router) => {
      router.get("/api/sessions", (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sessions: [] }));
      });

      router.post("/api/sessions", (req: IncomingMessage, res: ServerResponse) => {
        try {
          const data = ((req as unknown as Record<string, unknown>).body as { query?: string; mode?: string; model?: string; provider?: string }) ?? {};

          // Build modelId from provider+model or use explicit model or fallback to default
          const modelId = data.provider
            ? `${data.provider}:${data.model || config.ARELY_MODEL}`
            : (data.model ?? modelRegistry.getDefaultId());
          const session = sessionManager.createSession(sse, llm, {
            permissions: {
              websearch: config.ARELY_PERMIT_WEBSEARCH,
              webfetch: config.ARELY_PERMIT_WEBFETCH,
            },
            searchProvider: config.ARELY_WEBSEARCH_PROVIDER,
            model: modelId,
            modelId,
            toolMode: config.ARELY_TOOL_MODE,
            mode: data.mode === "swarm" ? "swarm" : data.mode === "planning" ? "planning" : "agent",
          });

          if (data.query) {
            session.run(data.query).catch((err: unknown) => {
              logger.error("session", "Session run error", {
                sessionId: session.id,
                error: err,
              });
            });
          }

          logger.info("session", "Session created", {
            sessionId: session.id,
            metadata: { hasQuery: Boolean(data.query), mode: data.mode ?? "agent" },
          });

          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              id: session.id,
              state: session.state,
              toolCallMode: session.toolCallMode,
            mode: data.mode === "swarm" ? "swarm" : data.mode === "planning" ? "planning" : "agent",
              model: modelId,
            }),
          );
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON", message: String(err) }));
        }
      });

      router.post("/api/sessions/:id/cancel", (_req: IncomingMessage, res: ServerResponse, params) => {
        const cancelled = sessionManager.cancelSession(params.id);
        if (cancelled) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
        }
      });

      if (config.AGENT_RUNTIME_ENABLED) {
        router.post("/api/webhooks/:agentId", (req: IncomingMessage, res: ServerResponse, params) => {
          const payload: unknown = (req as unknown as Record<string, unknown>).body ?? {};
          handleWebhook(params.agentId, { headers: {}, body: payload }, runtimeConfig)
            .then((result) => {
              res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            })
            .catch((err: unknown) => {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: String(err) }));
            });
        });

        router.get("/api/pipelines/:id/runs", (_req: IncomingMessage, res: ServerResponse, params) => {
          const runs = getPipelineRuns(params.id);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(runs));
        });

        router.get("/api/pipelines/:id/runs/:runId", (_req: IncomingMessage, res: ServerResponse, params) => {
          const run = getPipelineRun(params.runId);
          if (!run) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Run not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(run));
        });

        router.get("/api/pipelines/:id/runs/:runId/steps", (_req: IncomingMessage, res: ServerResponse, params) => {
          const steps = getPipelineStepRuns(params.runId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(steps));
        });

        const replayer = new ExecutionReplayer();
        router.post("/api/pipelines/:id/runs/:runId/replay", (req: IncomingMessage, res: ServerResponse, params) => {
          try {
            const data = ((req as unknown as Record<string, unknown>).body as { replayFrom?: string }) ?? {};
            if (!data.replayFrom) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "replayFrom is required" }));
              return;
            }
            replayer.replay(params.id, params.runId, data.replayFrom, runtimeConfig, tracer)
              .then((result) => {
                res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
                res.end(JSON.stringify(result));
              })
              .catch((err: unknown) => {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: String(err) }));
              });
          } catch (err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON", message: String(err) }));
          }
        });

        const comparator = new ExecutionComparator();
        router.get("/api/runs/:runA/compare/:runB", (_req: IncomingMessage, res: ServerResponse, params) => {
          try {
            const report = comparator.compare(params.runA, params.runB);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(report));
          } catch (err) {
            const msg = String(err);
            const status = msg.includes("not found") ? 404 : 400;
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: msg }));
          }
        });

        router.get("/api/metrics/overview", (_req: IncomingMessage, res: ServerResponse) => {
          const m = getOverviewMetrics();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, metrics: m }));
        });

        router.get("/api/metrics/tools", (_req: IncomingMessage, res: ServerResponse) => {
          const m = getToolMetrics();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, metrics: m }));
        });

        router.get("/api/metrics/pipelines", (_req: IncomingMessage, res: ServerResponse) => {
          const m = getPipelineMetrics();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, metrics: m }));
        });

        router.get("/api/metrics/errors", (_req: IncomingMessage, res: ServerResponse) => {
          const m = getErrorMetrics();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, metrics: m }));
        });

        router.get("/api/metrics/insights", (_req: IncomingMessage, res: ServerResponse) => {
          const result = getAllInsights();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, ...result }));
        });

        router.get("/api/alerts", (_req: IncomingMessage, res: ServerResponse) => {
          const alerts = evaluateAlertRules();
          sendAlerts(notifier, alerts);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, alerts }));
        });

        router.get("/api/remediations", (_req: IncomingMessage, res: ServerResponse) => {
          const insights = getAllInsights().insights;
          const alerts = evaluateAlertRules();
          const actions = generateRemediations(insights, alerts);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, actions }));
        });

        router.post("/api/alerts/test", (req: IncomingMessage, res: ServerResponse) => {
          const payload = ((req as unknown as Record<string, unknown>).body as Record<string, unknown>) ?? {};
          const sev = payload.severity as string | undefined;
          const alert: Alert = {
            ruleId: String(payload.ruleId ?? "test_rule"),
            severity: sev === "critical" ? "critical" : "warning",
            category: String(payload.category ?? "reliability"),
            message: String(payload.message ?? "Test alert notification"),
            metric: Number(payload.metric ?? 0),
            threshold: Number(payload.threshold ?? 0),
            target: String(payload.target ?? "test_tool"),
            createdAt: new Date().toISOString(),
          };
          notifier?.send(alert).catch(() => {});
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, alert }));
        });

        router.get("/api/circuit-breakers", (_req: IncomingMessage, res: ServerResponse) => {
          if (!breakerRegistry) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, breakers: [] }));
            return;
          }
          const breakers = breakerRegistry.getAllStates();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, breakers }));
        });

        router.post("/api/circuit-breakers/reset", (req: IncomingMessage, res: ServerResponse) => {
          if (!breakerRegistry) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, reset: [] }));
            return;
          }
          const payload = ((req as unknown as Record<string, unknown>).body as Record<string, unknown>) ?? {};
          let reset: string[] = [];
          if (payload.all === true) {
            reset = breakerRegistry.resetAll();
          } else if (payload.toolName) {
            breakerRegistry.reset(payload.toolName as string);
            reset = [payload.toolName as string];
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, reset }));
        });

        router.get("/api/notifications/queue", (_req: IncomingMessage, res: ServerResponse) => {
          if (!notificationService) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, metrics: { pending: 0, retrying: 0, sent: 0, dead: 0 } }));
            return;
          }
          const m = notificationService.getMetrics();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, metrics: m }));
        });

        router.get("/api/notifications/dead-letter", (_req: IncomingMessage, res: ServerResponse) => {
          if (!notificationService) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, notifications: [] }));
            return;
          }
          const notifications = notificationService.getDeadLetters();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, notifications }));
        });

        router.post("/api/notifications/dead-letter/:id/replay", (_req: IncomingMessage, res: ServerResponse, params) => {
          if (!notificationService) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, status: "not_available" }));
            return;
          }
          notificationService.replayDeadLetter(params.id)
            .then((result) => {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: result.ok, status: result.status }));
            })
            .catch((err: unknown) => {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: String(err) }));
            });
        });

        router.get("/api/notifications/metrics", (req: IncomingMessage, res: ServerResponse) => {
          const url = new URL(req.url ?? "/", "http://localhost");
          const windowStart = url.searchParams.get("windowStart") ?? undefined;
          const windowEnd = url.searchParams.get("windowEnd") ?? undefined;
          const m = getNotificationMetrics(windowStart, windowEnd);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, metrics: m }));
        });

        registerBuilderRoutes(router, builderService, sse, packageLoader, templateRegistry);
        registerTemplateRoutes(router, templateRegistry, TEMPLATES_DIR, USER_TEMPLATES_DIR, sse);
        registerPackageRoutes(router, { loader: packageLoader, packagesDir: config.PACKAGES_DIR, sse });
        const metricsService = new TemplateMetricsService();
        registerEvolutionRoutes(router, templateRegistry, compilerAdapter, sse, metricsService);

        router.get("/api/models", (_req: IncomingMessage, res: ServerResponse) => {
          const models = modelRegistry.getEnabled().map((m) => ({
            id: m.id,
            name: m.name,
            provider: m.provider,
            capabilities: m.capabilities,
            contextWindow: m.contextWindow,
            costTier: m.costTier,
          }));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, models }));
        });

        router.get("/api/models/stats", (_req: IncomingMessage, res: ServerResponse) => {
          const stats = llm.getModelMetrics().getAggregated();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, stats }));
        });

        router.get("/api/models/:id", (_req: IncomingMessage, res: ServerResponse, params) => {
          const def = modelRegistry.get(params.id);
          if (!def) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Model not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, model: def }));
        });
      }

      router.get("/api/sessions/:id/epochs", (_req: IncomingMessage, res: ServerResponse, params) => {
        try {
          const stats = getContextStats(params.id);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, ...stats }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });

      router.get("/api/sessions/:id/epochs/current", (_req: IncomingMessage, res: ServerResponse, params) => {
        try {
          const ctx = buildContext(params.id);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, ...ctx }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });

      // Memory routes — async wrapper because router doesn't await
      const asyncHandler = (
        fn: (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>,
      ) => {
        return (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
          fn(req, res, params).catch((err) => {
            try {
              if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: String(err) }));
              }
            } catch { /* ignore */ }
          });
        };
      };

      router.post("/api/memories", asyncHandler(async (req, res) => {
        const data = (req as any).body;
        if (!data || !data.type || !data.key || !data.value) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Missing required fields: type, key, value" }));
          return;
        }
        const memory = await memoryService.setMemory(
          data.sessionId ?? null,
          data.type,
          data.key,
          data.value,
          data.confidence ?? 100,
          data.source ?? "explicit",
          data.tags ?? [],
          data.epochId ?? null,
          data.ttlSeconds ?? null,
        );
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, memory }));
      }));

      router.get("/api/memories", asyncHandler(async (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const sessionId = url.searchParams.get("sessionId");
        const type = url.searchParams.get("type");
        const typeIn = url.searchParams.get("typeIn")?.split(",");
        const minConfidence = url.searchParams.get("minConfidence") ? Number(url.searchParams.get("minConfidence")) : undefined;
        const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 100;
        const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : 0;
        const memories = await memoryService.searchMemories(sessionId, {
          ...(type ? { type: type as any } : {}),
          ...(typeIn ? { typeIn: typeIn as any[] } : {}),
          minConfidence,
          limit,
          offset,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, memories }));
      }));

      router.get("/api/memories/:type/:key", asyncHandler(async (req, res, params) => {
        const memory = await memoryService.getMemory(params.type as any, params.key);
        if (!memory) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Memory not found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, memory }));
      }));

      router.delete("/api/memories/:type/:key", asyncHandler(async (req, res, params) => {
        const deleted = await memoryService.deleteMemory(params.type as any, params.key);
        res.writeHead(deleted ? 200 : 404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: deleted, deleted }));
      }));

      router.post("/api/memories/evict", asyncHandler(async (_req, res) => {
        const expired = await memoryService.evictExpired();
        const byCount = await memoryService.evictByCount();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, evicted: { expired, byCount } }));
      }));

      router.get("/api/memory/relevant", asyncHandler(async (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const query = url.searchParams.get("query");
        if (!query) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Missing query" }));
          return;
        }
        const sessionId = url.searchParams.get("sessionId");
        const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 10;
        const types = url.searchParams.get("types")?.split(",") as any[] | undefined;
        const memories = await memoryRetrievalService.getRelevant({
          sessionId: sessionId ?? undefined,
          query,
          types,
          limit,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, memories }));
      }));

      router.post("/api/memory/reindex", asyncHandler(async (_req, res) => {
        const expired = await memoryService.evictExpired();
        const byCount = await memoryService.evictByCount();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, reindexed: { expiredEvicted: expired, countEvicted: byCount } }));
      }));

      router.post("/api/decisions", asyncHandler(async (req, res) => {
        const data = (req as any).body;
        if (!data || !data.decisionType || !data.decision || !data.rationale) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Missing required fields: decisionType, decision, rationale" }));
          return;
        }
        const record = await decisionService.logDecision({
          sessionId: data.sessionId,
          decisionType: data.decisionType,
          decision: data.decision,
          rationale: data.rationale,
          confidence: data.confidence,
          proposalId: data.proposalId,
          templateId: data.templateId,
          outcome: data.outcome,
          outcomeDetail: data.outcomeDetail,
          metadata: data.metadata,
        });
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, decision: record }));
      }));

      router.get("/api/decisions", asyncHandler(async (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const q: any = {};
        const s = url.searchParams;
        if (s.get("sessionId")) q.sessionId = s.get("sessionId")!;
        if (s.get("decisionType")) q.decisionType = s.get("decisionType")!;
        if (s.get("proposalId")) q.proposalId = s.get("proposalId")!;
        if (s.get("templateId")) q.templateId = s.get("templateId")!;
        if (s.get("outcome")) q.outcome = s.get("outcome")!;
        if (s.get("limit")) q.limit = Number(s.get("limit"));
        if (s.get("offset")) q.offset = Number(s.get("offset"));
        const records = decisionService.queryDecisions(q);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, decisions: records }));
      }));

      router.get("/api/decisions/:id", asyncHandler(async (_req, res, params) => {
        const record = decisionService.getDecision(params.id);
        if (!record) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Decision not found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, decision: record }));
      }));

      router.put("/api/decisions/:id/outcome", asyncHandler(async (req, res, params) => {
        const data = (req as any).body;
        if (!data || !data.outcome) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Missing outcome" }));
          return;
        }
        const updated = decisionService.updateOutcome(params.id, data.outcome, data.outcomeDetail ?? undefined);
        if (!updated) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Decision not found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }));

      registerGoalRoutes(router);
      registerSwarmRoutes(router);
    },
  });

  packageLoader.reloadEnabled().catch((err: unknown) => {
    logger.warn("bootstrap", "Failed to reload some installed node packages", { error: String(err) });
  });
  try {
    packageLoader.reloadPackages();
    const pkgCount = listInstalledPackages().length;
    sse.emitSystem({
      id: ulid(),
      version: 1 as const,
      timestamp: Date.now(),
      type: "package_reloaded",
      packageCount: pkgCount,
    });
    logger.info("bootstrap", "Reloaded installed v2 packages", { metadata: { count: pkgCount } });
  } catch (err) {
    logger.warn("bootstrap", "Failed to reload installed v2 packages", { error: String(err) });
  }

  server.listen(config.PORT, () => {
    logger.info("bootstrap", `Server listening on port ${config.PORT}`, {
      metadata: { port: config.PORT },
    });
  });

  let shutdownInProgress = false;

  function shutdownHandler(reason: string) {
    return () => {
      if (shutdownInProgress) {
        forceExit();
        return;
      }
      shutdownInProgress = true;

      server.close();
      scheduler?.stop();
      if (queueInterval) clearInterval(queueInterval);

      startDrain({
        sse,
        sessionManager,
        reason,
        getActiveRequests: () => counter.active(),
        onDrainComplete: () => {
          process.exit(0);
        },
      }).catch((err) => {
        logger.error("shutdown", "Drain error", { error: err });
        process.exit(1);
      });
    };
  }

  process.on("SIGINT", shutdownHandler("SIGINT"));
  process.on("SIGTERM", shutdownHandler("SIGTERM"));
}

const isMainModule = process.argv[1] && (process.argv[1].endsWith("index.js") || process.argv[1].endsWith("index.ts"));
if (isMainModule) {
  try {
    main();
  } catch (err) {
    logger.error("bootstrap", "Fatal startup error", { error: err });
    process.exit(1);
  }
}
