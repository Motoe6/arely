import { getAgent } from "./agent-store.js";
import { NullSSEBus } from "./null-sse.js";
import type { SessionManager } from "../server/session-manager.js";
import type { LLMAdapter } from "@arelyos/llm-core";
import { getConfig } from "../config/index.js";
import { listPlansBySession, updatePlanAgentId } from "../persistence/plan-store.js";

export interface RuntimeConfig {
  sessionManager: SessionManager;
  llm: LLMAdapter;
  executeTool?: (
    toolName: string,
    args: Record<string, unknown>,
    ctx?: { stepId?: string; pipelineId?: string },
  ) => Promise<{ content: string; raw?: unknown }>;
}

export async function executeAgent(agentId: string, config: RuntimeConfig): Promise<{ ok: boolean; error?: string }> {
  const agent = getAgent(agentId);
  if (!agent) {
    return { ok: false, error: `Agent not found: ${agentId}` };
  }
  if (!agent.enabled) {
    return { ok: false, error: `Agent disabled: ${agentId}` };
  }

  const cfg = getConfig();
  const sse = new NullSSEBus();
  const session = config.sessionManager.createSession(sse, config.llm, {
    permissions: {
      websearch: cfg.ARELY_PERMIT_WEBSEARCH,
      webfetch: cfg.ARELY_PERMIT_WEBFETCH,
    },
    searchProvider: cfg.ARELY_WEBSEARCH_PROVIDER,
    model: cfg.ARELY_MODEL,
    toolMode: cfg.ARELY_TOOL_MODE,
    mode: "planning",
    agentId,
  });

  try {
    await session.run(agent.goal);

    const plans = listPlansBySession(session.id);
    if (plans.length > 0) {
      updatePlanAgentId(plans[plans.length - 1].id, agentId);
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
