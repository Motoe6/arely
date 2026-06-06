import { executeAgent } from "../runtime.js";
import type { RuntimeConfig } from "../runtime.js";

export interface WebhookPayload {
  headers: Record<string, string>;
  body: unknown;
}

const runningWebhooks = new Set<string>();

export async function handleWebhook(
  agentId: string,
  _payload: WebhookPayload,
  config: RuntimeConfig,
): Promise<{ ok: boolean; error?: string }> {
  if (runningWebhooks.has(agentId)) {
    return { ok: false, error: `Agent ${agentId} is already running` };
  }

  runningWebhooks.add(agentId);
  try {
    return await executeAgent(agentId, config);
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    runningWebhooks.delete(agentId);
  }
}
