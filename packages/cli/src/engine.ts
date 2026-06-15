import os from "node:os";
import { loadConfig, getConfig } from "@arelyos/engine/config/index.js";
import { connect } from "@arelyos/engine/persistence/database.js";
import { pushSchema } from "@arelyos/engine/persistence/migrate.js";
import { setSessionEngine } from "@arelyos/ui-core/services/session-service.js";
import { appStore } from "@arelyos/ui-core/stores/app-store.js";

interface SessionSummary {
  id: string;
  messages: { role: string; content: string }[];
}

export interface DashboardMetrics {
  sessions: number;
  memories: number;
  goals: number;
  swarmActive: boolean;
  predictionError: number;
  calibrationError: number;
  strategySuccess: number;
  avgLatencyMs: number;
  costToday: number;
}

export interface EngineContext {
  mode: "in-process" | "client";
  sse?: import("@arelyos/engine/server/sse.js").SSEBus;
  sessionManager?: import("@arelyos/engine/server/session-manager.js").SessionManager;
  apiBase?: string;
  getSessions: () => SessionSummary[];
  getMetrics?: () => Promise<DashboardMetrics>;
}

function cfg(key: string): string | undefined {
  const val = getConfig()[key];
  return typeof val === "string" ? val : undefined;
}

export async function bootEngine(): Promise<EngineContext> {
  const cfgRaw = loadConfig();
  connect(cfg("DB_PATH") || "./data/arely.db");
  pushSchema();

  const { SSEBus } = await import("@arelyos/engine/server/sse.js");
  const { SessionManager } = await import("@arelyos/engine/server/session-manager.js");
  const { ModelRegistry } = await import("@arelyos/engine/models/model-registry.js");
  const { ModelAwareAdapter } = await import("@arelyos/engine/models/model-adapter.js");

  const sse = new SSEBus();
  const modelRegistry = new ModelRegistry(cfg("ARELY_MODELS"), cfg("ARELY_MODEL"));
  const llm = new ModelAwareAdapter(modelRegistry, cfg("ARELY_API_KEY"));
  const sm = new SessionManager();

  const username = process.env.ARELY_USER || os.userInfo().username || "User";

  appStore.setState({
    provider: cfg("ARELY_PROVIDER") || "ollama",
    model: cfg("ARELY_MODEL") || "",
    isEngineRunning: true,
    username,
  });

  const { wireSSE } = await import("./hooks/useSSE.js");

  setSessionEngine({
    async run(query: string) {
      const session = sm.createSession(sse, llm, {
        permissions: {
          websearch: cfg("ARELY_PERMIT_WEBSEARCH") || "ask",
          webfetch: cfg("ARELY_PERMIT_WEBFETCH") || "ask",
        },
        searchProvider: cfg("ARELY_WEBSEARCH_PROVIDER") as "exa" | "parallel" | undefined,
        model: cfg("ARELY_MODEL"),
        modelId: cfg("ARELY_MODEL"),
        toolMode: cfg("ARELY_TOOL_MODE") as "native" | "text" | undefined,
        mode: "agent",
      });
      const unsubWire = wireSSE(sse, session.id);
      try {
        await session.run(query);
      } finally {
        unsubWire();
      }
    },
    cancel() {
      sm.cancelAllSessions();
    },
    onEvent() {},
  });

  return {
    mode: "in-process", sse, sessionManager: sm,
    getSessions: () => Array.from((sm as unknown as { sessions: Map<string, { id: string; messages: { role: string; content: string }[] }> }).sessions?.values() ?? []),
    getMetrics: async () => {
      try {
        const { goalService } = await import("@arelyos/engine/llm/goal-service.js");
        const { modelPerformanceService } = await import("@arelyos/engine/llm/model-performance-service.js");
        const convergence = modelPerformanceService.getConvergence();
        const snapshots = modelPerformanceService.getSnapshots();
        const goals = goalService.getActiveGoals();
        const sessionCount = (sm as unknown as { sessions: Map<string, unknown> }).sessions?.size ?? 0;
        const totalLatency = snapshots.reduce((a: number, s: { avgLatencyMs: number }) => a + s.avgLatencyMs, 0);
        const totalCost = snapshots.reduce((a: number, s: { avgCostUsd: number }) => a + s.avgCostUsd, 0);
        const avgLatency = snapshots.length > 0 ? totalLatency / snapshots.length : 0;
        const avgSuccess = convergence.length > 0
          ? convergence.reduce((a: number, c: { successRate: number }) => a + c.successRate, 0) / convergence.length
          : 0;
        return {
          sessions: sessionCount,
          memories: 0,
          goals: goals.length,
          swarmActive: appStore.getState().agentMode === "swarm" || appStore.getState().agentMode === "shared-memory",
          predictionError: 0.12,
          calibrationError: 0.08,
          strategySuccess: Math.round(avgSuccess * 100),
          avgLatencyMs: Math.round(avgLatency),
          costToday: Number(totalCost.toFixed(4)),
        };
      } catch {
        return { sessions: 0, memories: 0, goals: 0, swarmActive: false, predictionError: 0, calibrationError: 0, strategySuccess: 0, avgLatencyMs: 0, costToday: 0 };
      }
    },
  };
}

export async function connectToServer(apiBase: string): Promise<EngineContext> {
  appStore.setState({
    provider: "remote",
    model: "remote",
    isEngineRunning: true,
  });

  setSessionEngine({
    async run(query: string) {
      const res = await fetch(`${apiBase}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: query }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
    },
    cancel() {
      fetch(`${apiBase}/api/sessions/current/cancel`, { method: "POST" }).catch(() => {});
    },
    onEvent() {},
  });

  return {
    mode: "client", apiBase,
    getSessions: () => [],
    getMetrics: async () => ({ sessions: 0, memories: 0, goals: 0, swarmActive: false, predictionError: 0, calibrationError: 0, strategySuccess: 0, avgLatencyMs: 0, costToday: 0 }),
  };
}
