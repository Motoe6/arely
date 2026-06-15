import { ulid } from "ulid";
import type { LLMAdapter } from "@arely/llm-core";
import type { SessionMessage } from "../types.js";
import type { PlanRecord, PlanStepRecord } from "../types.js";
import type { Tool } from "../tools/base-tool.js";
import { PlanOutputSchema, validateBusinessRules, normalizePlanOutput } from "./plan-schema.js";
import type { PlanOutput } from "./plan-schema.js";
import { buildPlannerPrompt, buildToolDescriptions, buildRetryPrompt } from "./prompts.js";
import { getConfig } from "../config/index.js";

export type PlannerResult =
  | { ok: true; plan: PlanRecord; steps: PlanStepRecord[] }
  | { ok: false; error: string };

async function collectResponse(
  llm: LLMAdapter,
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  messages: SessionMessage[],
  signal?: AbortSignal,
): Promise<string> {
  let content = "";
  for await (const chunk of llm.complete(messages, signal)) {
    content += chunk.content;
  }
  return content.trim();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)\s*\n?```/.exec(text);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function createPlan(
  goal: string,
  llm: LLMAdapter,
  tools: Map<string, Tool>,
  opts: { sessionId: string; signal?: AbortSignal },
): Promise<PlannerResult> {
  if (opts.signal?.aborted) {
    return { ok: false, error: "Plan cancelled" };
  }

  const maxSteps = getConfig().PLAN_MAX_STEPS;
  const toolDescriptions = buildToolDescriptions(tools);
  let prompt = buildPlannerPrompt(goal, toolDescriptions, maxSteps);

  for (let attempt = 0; attempt < 2; attempt++) {
    if (opts.signal?.aborted) {
      return { ok: false, error: "Plan cancelled" };
    }
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const messages: SessionMessage[] = [
      { role: "system", content: prompt, timestamp: Date.now() },
      { role: "user", content: goal, timestamp: Date.now() },
    ];

    const response = await collectResponse(llm, messages, opts.signal);
    if (!response) {
      if (attempt === 1) {
        return { ok: false, error: "LLM returned empty response" };
      }
      prompt = buildRetryPrompt("", ["Response was empty"]);
      continue;
    }

    const parsed = parseJson(response);
    if (!parsed) {
      if (attempt === 1) {
        return { ok: false, error: "Failed to parse JSON from LLM response" };
      }
      prompt = buildRetryPrompt(response, ["Response was not valid JSON"]);
      continue;
    }

    const schemaResult = PlanOutputSchema.safeParse(parsed);
    if (!schemaResult.success) {
      if (attempt === 1) {
        return { ok: false, error: `Schema validation failed: ${schemaResult.error.message}` };
      }
      prompt = buildRetryPrompt(response, ["Output did not match the required schema structure"]);
      continue;
    }

    const output: PlanOutput = schemaResult.data;
    const validation = validateBusinessRules(output, tools, maxSteps);

    const nonRetryable = validation.errors.filter((e) => !e.retryable);
    if (nonRetryable.length > 0) {
      return { ok: false, error: nonRetryable.map((e) => e.message).join("; ") };
    }

    const retryable = validation.errors.filter((e) => e.retryable);
    if (retryable.length > 0) {
      if (attempt === 1) {
        return {
          ok: false,
          error: `Plan validation failed after retry: ${retryable.map((e) => e.message).join("; ")}`,
        };
      }
      prompt = buildRetryPrompt(response, retryable.map((e) => e.message));
      continue;
    }

    const planId = ulid();
    const now = new Date().toISOString();

    const plan: PlanRecord = {
      id: planId,
      sessionId: opts.sessionId,
      agentId: null,
      goal,
      status: "pending",
      createdAt: now,
      completedAt: null,
    };

    const steps = normalizePlanOutput(output, planId, maxSteps);

    return { ok: true, plan, steps };
  }

  return { ok: false, error: "Unexpected error in planner" };
}
