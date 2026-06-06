import type { PlanStepRecord } from "../types.js";
import type { Tool, ToolContext } from "../tools/base-tool.js";
import { CancelledError } from "../tools/errors.js";

export type StepResult =
  | {
      stepId: string;
      status: "completed";
      result: string;
      durationMs: number;
    }
  | {
      stepId: string;
      status: "failed";
      error: string;
      durationMs: number;
    }
  | {
      stepId: string;
      status: "skipped";
      reason: string;
      durationMs: 0;
    }
  | {
      stepId: string;
      status: "blocked";
      reason: string;
      durationMs: 0;
    };

function parseArgs(args: string | null): Record<string, unknown> {
  if (!args) return {};
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function executePlanStep(
  step: PlanStepRecord,
  tools: Map<string, Tool>,
  context: ToolContext,
  signal?: AbortSignal,
): Promise<StepResult> {
  const start = Date.now();

  if (!step.tool) {
    return {
      stepId: step.id,
      status: "completed",
      result: step.description,
      durationMs: 0,
    };
  }

  const tool = tools.get(step.tool);
  if (!tool) {
    return {
      stepId: step.id,
      status: "failed",
      error: `Unknown tool: ${step.tool}`,
      durationMs: 0,
    };
  }

  const args = parseArgs(step.args);
  const ctx: ToolContext = { sessionId: context.sessionId, signal };

  try {
    const result = await tool.execute(args, ctx);
    return {
      stepId: step.id,
      status: "completed",
      result: result.content,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    if (err instanceof CancelledError) {
      return {
        stepId: step.id,
        status: "failed",
        error: "Step was cancelled",
        durationMs: Date.now() - start,
      };
    }
    return {
      stepId: step.id,
      status: "failed",
      error: String(err),
      durationMs: Date.now() - start,
    };
  }
}
