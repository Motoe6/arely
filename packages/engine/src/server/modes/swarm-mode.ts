import { ulid } from "ulid";
import type { ExecutionMode, ExecutionResult } from "../execution-mode.js";
import type { AgentSession } from "../session.js";
import type { SessionMessage } from "../../types.js";
import type { AgentEvent } from "../../types/events.js";
import type { LLMAdapter } from "@arelyos/llm-core";
import type { AgentExecutor, HeterogeneousExecutor } from "../../llm/swarm-orchestrator.js";
import type { SwarmAgentRole, ParallelSwarmResult } from "../../llm/swarm-task-types.js";
import { ParallelSwarmOrchestrator } from "../../llm/parallel-swarm-orchestrator.js";
import { registerSwarmExecution } from "../../routes/swarm-routes.js";
import { metrics } from "../../metrics.js";
import { tracer } from "../../tracer.js";
import { selectRoles, loadProviderSummary, getProviderCategoryStats, runLearningCycle, recordPerformance, loadLearnedWeights, getWeightsForCategory } from "@arelyos/agent-core/swarm/index.js";
import type { RoleAssignment, TaskCategory, RolePerformanceRecord, LearnedWeights } from "@arelyos/agent-core/swarm/index.js";
import { getConfig } from "../../config/index.js";
import { DistributedSwarmExecutor } from "../../swarm/distributed-swarm-executor.js";
import { Coordinator } from "@arelyos/distributed";

function createAgentExecutor(llm: LLMAdapter, signal?: AbortSignal, roleMap?: Map<string, RoleAssignment>): AgentExecutor & HeterogeneousExecutor {
  return async (role, systemPrompt, task, context, modelId?: string) => {
    const roleName = role as string;
    const assignment = roleMap?.get(roleName);
    const resolvedModelId = modelId ?? (assignment ? `${assignment.provider}:${assignment.model}` : undefined);

    const messages: SessionMessage[] = [
      { role: "system", content: systemPrompt, timestamp: Date.now() },
      { role: "user", content: `${task}\n\nContext:\n${context}`, timestamp: Date.now() },
    ];
    let result = "";
    for await (const response of llm.complete(messages, signal, resolvedModelId as any)) {
      if (response.type !== "delta") {
        result += response.content ?? "";
      }
    }
    return result;
  };
}

export class SwarmModeExecution implements ExecutionMode {
  readonly name = "swarm";
  private static coordinator?: Coordinator;

  private static getCoordinator(url: string): Coordinator {
    if (this.coordinator) return this.coordinator;
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = Number(parsed.port || (parsed.protocol === "wss:" ? 443 : 80));
    this.coordinator = new Coordinator(
      { port, scheduleStrategy: "least_loaded" },
      {
        onMetric: (event) => {
          if (event.type === "counter") {
            metrics.increment(event.name, event.labels);
          } else if (event.type === "gauge") {
            metrics.setGauge(event.name, event.labels ?? {}, event.value ?? 0);
          } else if (event.type === "histogram") {
            metrics.observeDuration(event.name, event.labels ?? {}, event.durationMs ?? 0);
          }
        },
      },
    );
    this.coordinator.start("websocket");
    return this.coordinator;
  }

  constructor(private category?: TaskCategory) {}

  async run(session: AgentSession, input: string): Promise<ExecutionResult> {
    if (session.abortSignal.aborted) {
      return { content: "Swarm cancelled", turns: 0 };
    }

    const cfg = getConfig();
    const distributed = cfg.ARELY_EXECUTION_MODE === "distributed";
    const coordinatorUrl = cfg.ARELY_COORDINATOR_URL || "ws://localhost:9091";

    const traceId = `swarm-${ulid()}`;
    const rootSpan = tracer.startSpan(traceId, "swarm.run", undefined);

    // T15.4 Learning cycle — adjust weights from historical outcomes
    const learningSpan = tracer.startSpan(traceId, "swarm.learning", rootSpan.spanId);
    const learnedWeights = runLearningCycle();
    tracer.endSpan(learningSpan, { category: this.category ?? "coding" });

    // Dynamic role selection with learned weights
    const selectSpan = tracer.startSpan(traceId, "swarm.select", rootSpan.spanId);
    let assignments: RoleAssignment[] = [];
    try {
      const summary = loadProviderSummary();
      if (summary) {
        const stats = getProviderCategoryStats(summary);
        assignments = selectRoles({
          taskCategory: this.category ?? "coding",
          providerStats: stats,
          learnedWeights,
        });
      }
    } catch {
      // No benchmark data available; run with defaults
    }
    tracer.endSpan(selectSpan, { roles: assignments.length, category: this.category ?? "coding" });

    const roleMap = new Map<string, RoleAssignment>();
    for (const a of assignments) {
      roleMap.set(a.role, a);
    }

    // Emit role selection events with full explainability data
    const fullWeights = loadLearnedWeights();
    const catWeights = getWeightsForCategory(fullWeights, this.category ?? "coding");
    for (const a of assignments) {
      const event: AgentEvent = {
        id: ulid(),
        version: 1 as const,
        timestamp: Date.now(),
        type: "swarm_role_selected",
        sessionId: session.id,
        role: a.role,
        provider: a.provider,
        model: a.model,
        score: a.score,
        confidence: a.confidence,
        reason: a.reason ?? "auto_selected",
        weights: {
          historical: catWeights.historicalScore,
          utility: catWeights.utility,
          availability: catWeights.availability,
          cost: catWeights.costEfficiency,
          latency: catWeights.latencyScore,
        },
      };
      session.sse.emit(session.id, event);

      // Learning metrics per role assignment
      metrics.setGauge("distributed_role_selection_score", { role: a.role, provider: a.provider, model: a.model, category: this.category ?? "coding" }, a.score);
      metrics.setGauge("distributed_role_selection_confidence", { role: a.role, provider: a.provider, model: a.model, category: this.category ?? "coding" }, a.confidence);
    }

    // Learning cycle metrics
    metrics.setGauge("distributed_learning_gain", { category: this.category ?? "coding" }, catWeights.historicalScore);
    metrics.setGauge("distributed_benchmark_drift", { category: this.category ?? "coding" }, catWeights.utility);

    // Emit learning update event
    const learningEvent: AgentEvent = {
      id: ulid(),
      version: 1 as const,
      timestamp: Date.now(),
      type: "swarm_learning_update",
      sessionId: session.id,
      category: this.category ?? "coding",
      weights: {
        historicalScore: catWeights.historicalScore,
        utility: catWeights.utility,
        availability: catWeights.availability,
        costEfficiency: catWeights.costEfficiency,
        latencyScore: catWeights.latencyScore,
      },
    };
    session.sse.emit(session.id, learningEvent);

    // Initialize coordinator lazily on first distributed run
    let coordinator: Coordinator | undefined;
    if (distributed) {
      coordinator = SwarmModeExecution.getCoordinator(coordinatorUrl);
    }

    // Emit execution mode event
    const modeEvent: AgentEvent = {
      id: ulid(),
      version: 1 as const,
      timestamp: Date.now(),
      type: "swarm_execution_mode",
      sessionId: session.id,
      mode: distributed ? "distributed" : "local",
      ...(distributed ? { coordinatorUrl } : {}),
      ...(distributed && coordinator ? { workerCount: coordinator.registry.getActiveWorkerCount() } : {}),
    };
    session.sse.emit(session.id, modeEvent);

    session.sse.emit(session.id, {
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "session_thinking",
      sessionId: session.id,
    });

    const swarmId = `swarm-${ulid().slice(0, 16)}`;
    registerSwarmExecution(swarmId, "running");

    const executor = createAgentExecutor(session.llm, session.abortSignal, roleMap);
    const providerModelMap = new Map<string, { provider: string; model: string }>();
    for (const a of assignments) {
      providerModelMap.set(a.role, { provider: a.provider, model: a.model });
    }
    const orchestrator = new ParallelSwarmOrchestrator(executor, { roleMap: providerModelMap });

    const startMs = Date.now();

    // Record metrics per role assignment
    metrics.increment("swarm_executions_total");
    for (const a of assignments) {
      metrics.increment("provider_requests_total", { provider: a.provider, role: a.role, model: a.model });
      metrics.increment("role_assignments_total", { role: a.role, provider: a.provider });
    }

    if (distributed) {
      metrics.increment("distributed_swarm_executions_total");
    }

    try {
      const executeSpan = tracer.startSpan(traceId, "swarm.execute", rootSpan.spanId);

      // Create per-role execution spans
      const roleSpans = new Map<string, ReturnType<typeof tracer.startSpan>>();
      for (const a of assignments) {
        const roleSpan = tracer.startSpan(traceId, `role.${a.role}`, executeSpan.spanId);
        roleSpans.set(a.role, roleSpan);
      }

      let result: ParallelSwarmResult;

      if (distributed) {
        const distExecutor = new DistributedSwarmExecutor({
          coordinator: coordinator!,
        });
        result = await distExecutor.execute(session.id, input, assignments);
      } else {
        result = await orchestrator.run(input);
      }

      const elapsedMs = Date.now() - startMs;

      if (distributed) {
        metrics.observeDuration("distributed_swarm_latency_ms", {}, elapsedMs);
        for (const a of assignments) {
          metrics.add("distributed_roles_remote_total", { role: a.role, provider: a.provider, model: a.model }, 1);
        }
      }

      // End all role spans
      let roleSuccesses = 0;
      for (const a of assignments) {
        const roleSpan = roleSpans.get(a.role);
        if (roleSpan) {
          const output = result.outputs[a.role] ?? "";
          const roleSuccess = !!output;
          if (roleSuccess) roleSuccesses++;
          tracer.endSpan(roleSpan, {
            role: a.role,
            provider: a.provider,
            model: a.model,
            sessionId: session.id,
            swarmId,
            success: roleSuccess,
            latencyMs: elapsedMs,
          });
        }
      }

      tracer.endSpan(executeSpan, {
        success: true,
        latencyMs: elapsedMs,
        roles: assignments.length,
        successfulRoles: roleSuccesses,
      });

      metrics.observeDuration("swarm_latency_ms", { category: this.category ?? "coding" }, elapsedMs);

      // Role assignment accuracy: proportion of roles that produced output
      const roleAccuracy = assignments.length > 0 ? roleSuccesses / assignments.length : 0;
      metrics.setGauge("role_assignment_accuracy", { category: this.category ?? "coding" }, roleAccuracy);

      // Provider selection accuracy per provider
      for (const a of assignments) {
        const output = result.outputs[a.role] ?? "";
        const success = !!output;
        metrics.setGauge("provider_selection_accuracy", { provider: a.provider, role: a.role }, success ? 1 : 0);
      }

      // Learning gain: average role score vs baseline (0.5)
      const avgScore = assignments.reduce((s, a) => s + a.score, 0) / Math.max(assignments.length, 1);
      metrics.setGauge("learning_gain", { category: this.category ?? "coding" }, avgScore);

      // Benchmark drift: 1 - roleAccuracy as a proxy
      metrics.setGauge("benchmark_drift", { category: this.category ?? "coding" }, 1 - roleAccuracy);

      for (const a of assignments) {
        metrics.observeDuration("provider_latency_ms", { provider: a.provider, model: a.model }, elapsedMs);
      }
      registerSwarmExecution(swarmId, "completed", result);

      const synthesis = result.synthesis || result.review || Object.values(result.outputs).join("\n\n");
      session.pushMessage("assistant", synthesis);

      // Record role performance for T15.4
      for (const a of assignments) {
        const id = a.role;
        const taskOutput = result.outputs[id] ?? synthesis;
        const record: RolePerformanceRecord = {
          timestamp: new Date().toISOString(),
          sessionId: session.id,
          category: this.category ?? "coding",
          role: a.role,
          provider: a.provider,
          model: a.model,
          success: true,
          latencyMs: Date.now() - startMs,
          utility: a.score,
          score: a.score,
        };
        recordPerformance(record);
      }

      // Track session duration
      metrics.observeDuration("session_duration_seconds", { sessionId: session.id }, Date.now() - startMs);

      session.sse.emit(session.id, {
        id: ulid(),
        version: 1,
        timestamp: Date.now(),
        type: "assistant_message_completed",
        sessionId: session.id,
        messageId: ulid(),
        content: synthesis,
      });

      tracer.endSpan(rootSpan, {
        success: true,
        sessionId: session.id,
        swarmId,
        latencyMs: elapsedMs,
        roleCount: assignments.length,
      });

      return { content: synthesis, turns: 1 };
    } catch (err) {
      const elapsedMs = Date.now() - startMs;
      metrics.increment("swarm_executions_total", { status: "failed" });
      metrics.increment("swarm_failures_total", { category: this.category ?? "coding" });

      if (distributed) {
        metrics.increment("distributed_swarm_executions_total", { status: "failed" });
      }

      // Track role failures per provider
      for (const a of assignments) {
        metrics.increment("provider_failures_total", { provider: a.provider, role: a.role });
      }

      registerSwarmExecution(swarmId, "failed");

      // Record failure for T15.4
      for (const a of assignments) {
        const record: RolePerformanceRecord = {
          timestamp: new Date().toISOString(),
          sessionId: session.id,
          category: this.category ?? "coding",
          role: a.role,
          provider: a.provider,
          model: a.model,
          success: false,
          latencyMs: Date.now() - startMs,
          utility: 0,
          score: a.score * 0.2,
        };
        recordPerformance(record);
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      session.pushMessage("assistant", `Swarm execution failed: ${errorMsg}`);

      tracer.endSpan(rootSpan, {
        success: false,
        sessionId: session.id,
        swarmId,
        latencyMs: elapsedMs,
        error: errorMsg,
      }, errorMsg);

      session.sse.emit(session.id, {
        id: ulid(),
        version: 1,
        timestamp: Date.now(),
        type: "agent_loop_failed",
        sessionId: session.id,
        error: errorMsg,
        turns: 0,
      });

      return { content: `Swarm failed: ${errorMsg}`, turns: 0 };
    }
  }
}
