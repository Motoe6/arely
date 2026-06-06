import { getPipeline, getPipelineSteps, createPipelineRun, updatePipelineRunStatus, incrementPipelineRunStepsCompleted } from "./pipeline-store.js";
import type { PipelineStepRecord } from "./pipeline-store.js";
import type { ExecutionErrorKind } from "./execution-contract.js";
import { executeAgent, type RuntimeConfig } from "./runtime.js";
import { agentMemorySet, agentMemoryList } from "../tools/memory.js";
import { logger } from "../logger.js";
import type { ExecutionTracer } from "./execution-tracer.js";
import { classifyExecutionError } from "./error-classifier.js";
import { CancelledError } from "../tools/errors.js";
import { computeDelay } from "./retry-policy.js";
import type { RetryStrategy } from "./execution-contract.js";

export interface PipelineExecutionResult {
  ok: boolean;
  error?: string;
  runId: string;
  stepResults: PipelineStepResult[];
}

export interface PipelineStepResult {
  stepId: string;
  agentId: string | null;
  stepOrder: number;
  status: "completed" | "failed" | "skipped";
  error?: string;
}

export interface ExecutionSnapshot {
  stepOutputs: Map<string, string>;
  stepStates: Map<string, "completed" | "failed" | "skipped">;
}

export interface PipelineExecutionOptions {
  replayFrom?: string;
  replayOf?: string;
  snapshot?: ExecutionSnapshot;
}

export async function executePipeline(
  pipelineId: string,
  config: RuntimeConfig,
  tracer?: ExecutionTracer,
  options?: PipelineExecutionOptions,
): Promise<PipelineExecutionResult> {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) {
    return { ok: false, error: `Pipeline not found: ${pipelineId}`, runId: "", stepResults: [] };
  }

  const steps = getPipelineSteps(pipelineId);
  if (steps.length === 0) {
    return { ok: false, error: `Pipeline ${pipelineId} has no steps`, runId: "", stepResults: [] };
  }

  const run = createPipelineRun({ pipelineId, stepsTotal: steps.length, replayOf: options?.replayOf ?? null });
  updatePipelineRunStatus(run.id, "running");
  tracer?.onRunStart(pipelineId, run.id, steps.length);

  const sorted = topologicalSort(steps);
  if ("error" in sorted) {
    updatePipelineRunStatus(run.id, "failed", sorted.error);
    tracer?.onRunComplete(run.id, "failed");
    return { ok: false, error: sorted.error, runId: run.id, stepResults: [] };
  }

  const stepResults: PipelineStepResult[] = [];
  const stepOutputs = new Map<string, string>();
  const failedSteps = new Set<string>();
  let passedReplayPoint = !options?.replayFrom;

  for (const step of sorted) {
    if (options?.replayFrom && step.id === options.replayFrom) {
      passedReplayPoint = true;
    }

    if (!passedReplayPoint && options?.snapshot) {
      const state = options.snapshot.stepStates.get(step.id);
      const cachedOutput = options.snapshot.stepOutputs.get(step.id);
      const outputKey = step.outputKey ?? step.id;

      if (state === "completed" && cachedOutput !== undefined) {
        stepOutputs.set(outputKey, cachedOutput);
        stepResults.push({
          stepId: step.id,
          agentId: agentIdForStep(step),
          stepOrder: step.stepOrder,
          status: "completed",
        });
        continue;
      }
      if (state === "skipped") {
        stepResults.push({
          stepId: step.id,
          agentId: agentIdForStep(step),
          stepOrder: step.stepOrder,
          status: "skipped",
          error: "Skipped in original run",
        });
        continue;
      }
      if (state === "failed") {
        failedSteps.add(step.id);
        stepResults.push({
          stepId: step.id,
          agentId: agentIdForStep(step),
          stepOrder: step.stepOrder,
          status: "failed",
          error: "Failed in original run",
        });
        continue;
      }
    }

    const deps = safeParseJsonArray(step.dependsOn);

    const failedDep = deps.find((d) => failedSteps.has(d));
    if (failedDep) {
      const reason = `Dependency ${failedDep} failed`;
      tracer?.onStepSkip(run.id, step.id, reason);
      stepResults.push({
        stepId: step.id,
        agentId: agentIdForStep(step),
        stepOrder: step.stepOrder,
        status: "skipped",
        error: reason,
      });
      continue;
    }

    const outputKey = step.outputKey ?? step.id;
    const input = step.inputMapping
      ? JSON.stringify({ inputMapping: step.inputMapping, dependsOn: step.dependsOn })
      : JSON.stringify({ dependsOn: step.dependsOn });

    const execResult = await executeStep(step, stepOutputs, config, run.id, tracer, input);

    if (execResult.ok) {
      incrementPipelineRunStepsCompleted(run.id);
      stepResults.push({
        stepId: step.id,
        agentId: agentIdForStep(step),
        stepOrder: step.stepOrder,
        status: "completed",
      });

      if (execResult.output !== undefined) {
        stepOutputs.set(outputKey, execResult.output);
      }
    } else {
      failedSteps.add(step.id);
      stepResults.push({
        stepId: step.id,
        agentId: agentIdForStep(step),
        stepOrder: step.stepOrder,
        status: "failed",
        error: execResult.error,
      });
    }
  }

  const overallOk = failedSteps.size === 0;
  updatePipelineRunStatus(run.id, overallOk ? "completed" : "failed", overallOk ? undefined : "Some steps failed");
  tracer?.onRunComplete(run.id, overallOk ? "completed" : "failed");

  logger.info("pipeline", `Pipeline ${pipelineId} ${overallOk ? "completed" : "failed"}`, {
    metadata: { runId: run.id, steps: steps.length, completed: stepResults.filter((r) => r.status === "completed").length, failed: failedSteps.size },
  });

  return {
    ok: overallOk,
    runId: run.id,
    stepResults,
    ...(overallOk ? {} : { error: "Some steps failed" }),
  };
}

function agentIdForStep(step: PipelineStepRecord): string | null {
  return step.type === "tool" ? step.toolName : step.agentId;
}

async function executeStep(
  step: PipelineStepRecord,
  stepOutputs: Map<string, string>,
  config: RuntimeConfig,
  runId: string,
  tracer?: ExecutionTracer,
  input?: string,
): Promise<{ ok: boolean; output?: string; error?: string; errorKind?: ExecutionErrorKind }> {
  if (step.type === "tool") {
    return executeToolStep(step, stepOutputs, config, runId, tracer, input);
  }
  return executeAgentStep(step, stepOutputs, config, runId, tracer, input);
}

async function executeToolStep(
  step: PipelineStepRecord,
  stepOutputs: Map<string, string>,
  config: RuntimeConfig,
  runId: string,
  tracer?: ExecutionTracer,
  input?: string,
): Promise<{ ok: boolean; output?: string; error?: string; errorKind?: ExecutionErrorKind }> {
  const toolName = step.toolName;
  if (!toolName) {
    return { ok: false, error: "Tool step missing toolName" };
  }
  if (!config.executeTool) {
    return { ok: false, error: "Pipeline tool execution not configured" };
  }

  const deps = safeParseJsonArray(step.dependsOn);
  for (const dep of deps) {
    if (!stepOutputs.has(dep)) {
      return { ok: false, error: `Missing dependency output: ${dep}` };
    }
  }

  const args = resolveInputMapping(step.inputMapping, stepOutputs);
  const stepInput = input ?? JSON.stringify({ dependsOn: step.dependsOn });

  const effectiveRetries = step.idempotent ? (step.retries ?? 0) : 0;
  const retryDelayMs = step.retryDelayMs ?? 1000;
  const retryableErrors = step.retryableErrors ?? [];
  const retryStrategy: RetryStrategy = step.retryStrategy ?? "fixed";

  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    tracer?.onStepStart(runId, step, stepInput, attempt);

    try {
      const result = await config.executeTool(toolName, args, {
        stepId: step.id,
        pipelineId: step.pipelineId,
      });
      tracer?.onStepComplete(runId, step.id, result.content, attempt);
      return { ok: true, output: result.content };
    } catch (err) {
      const errorStr = String(err);
      const errorKind = classifyExecutionError(err);
      tracer?.onStepFail(runId, step.id, errorStr, attempt);

      if (attempt < effectiveRetries && retryableErrors.includes(errorKind)) {
        const delay = computeDelay(attempt + 1, retryDelayMs, retryStrategy);
        await sleep(delay);
        continue;
      }

      return { ok: false, error: errorStr, errorKind };
    }
  }

  return { ok: false, error: "All retry attempts exhausted" };
}

async function executeAgentStep(
  step: PipelineStepRecord,
  stepOutputs: Map<string, string>,
  config: RuntimeConfig,
  runId: string,
  tracer?: ExecutionTracer,
  input?: string,
): Promise<{ ok: boolean; output?: string; error?: string; errorKind?: ExecutionErrorKind }> {
  const agentId = step.agentId;
  if (!agentId) {
    return { ok: false, error: "Agent step missing agentId" };
  }

  const stepInput = input ?? JSON.stringify({ dependsOn: step.dependsOn });
  tracer?.onStepStart(runId, step, stepInput);

  if (step.inputMapping) {
    const mapping = tryParseJson(step.inputMapping);
    if (mapping) {
      for (const [memoryKey, sourceStepId] of Object.entries(mapping)) {
        const sourceOutput = stepOutputs.get(sourceStepId);
        if (sourceOutput) {
          agentMemorySet(agentId, memoryKey, sourceOutput);
        }
      }
    }
  }

  try {
    const result = await executeAgent(agentId, config);

    if (result.ok) {
      const planOutput = capturePlanOutput(agentId);
      tracer?.onStepComplete(runId, step.id, planOutput ?? "");
      return { ok: true, output: planOutput };
    }
    tracer?.onStepFail(runId, step.id, result.error ?? "Unknown error");
    return { ok: false, error: result.error, errorKind: "internal" };
  } catch (err) {
    const errorStr = String(err);
    const errorKind = classifyExecutionError(err);
    tracer?.onStepFail(runId, step.id, errorStr);
    return { ok: false, error: errorStr, errorKind };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError("Operation cancelled during retry delay"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError("Operation cancelled during retry delay"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveInputMapping(
  json: string | null,
  stepOutputs: Map<string, string>,
): Record<string, string> {
  const mapping = tryParseJson(json) ?? {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapping)) {
    const strVal = value;
    const match = /^\{\{([a-zA-Z0-9_-]+)\}\}$/.exec(strVal);
    result[key] = match ? (stepOutputs.get(match[1]) ?? strVal) : strVal;
  }
  return result;
}

function capturePlanOutput(agentId: string): string | undefined {
  try {
    const memories = agentMemoryList(agentId);
    if (memories.length === 0) return undefined;
    const last = memories[memories.length - 1];
    return last.value;
  } catch {
    return undefined;
  }
}

function topologicalSort(steps: PipelineStepRecord[]): PipelineStepRecord[] | { error: string } {
  const nodes = new Map<string, PipelineStepRecord>();
  const deps = new Map<string, string[]>();

  for (const step of steps) {
    nodes.set(step.id, step);
    deps.set(step.id, safeParseJsonArray(step.dependsOn));
  }

  const sorted: PipelineStepRecord[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function visit(nodeId: string): string | undefined {
    if (inStack.has(nodeId)) return `Cycle detected involving step ${nodeId}`;
    if (visited.has(nodeId)) return undefined;

    inStack.add(nodeId);
    const stepDeps = deps.get(nodeId) ?? [];
    for (const depId of stepDeps) {
      const depNode = nodes.get(depId);
      if (!depNode) continue;
      const err = visit(depId);
      if (err) return err;
    }
    inStack.delete(nodeId);
    visited.add(nodeId);

    const node = nodes.get(nodeId);
    if (node) sorted.push(node);
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      const err = visit(step.id);
      if (err) return { error: err };
    }
  }

  return sorted;
}

function safeParseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function tryParseJson(json: string | null | undefined): Record<string, string> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}
