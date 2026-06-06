import { ulid } from "ulid";
import type { PlanRecord, PlanStepRecord } from "../types.js";
import type { Tool } from "../tools/base-tool.js";
import { ParallelExecutor } from "../tools/parallel-executor.js";
import { getConfig } from "../config/index.js";
import type { AgentEvent } from "../types/events.js";
import { executePlanStep, type StepResult } from "./executor.js";

export type { StepResult };

export interface WorkflowCallbacks {
  onStepRunning?: (stepId: string) => void | Promise<void>;
  onStepCompleted?: (stepId: string, result: string) => void | Promise<void>;
  onStepFailed?: (stepId: string, error: string) => void | Promise<void>;
  onStepBlocked?: (stepId: string) => void | Promise<void>;
  onStepSkipped?: (stepId: string) => void | Promise<void>;
}

function fireAndForget(fn: (() => void | Promise<void>) | undefined): void {
  if (!fn) return;
  try {
    const r = fn();
    if (r instanceof Promise) {
      r.catch(() => undefined);
    }
  } catch {
    void 0;
  }
}

export interface WorkflowResult {
  planId: string;
  status: "completed" | "failed";
  completedSteps: number;
  failedSteps: number;
  executionTimeMs: number;
  results: StepResult[];
}

function markBlockedTransitive(node: StepNode, graph: Map<string, StepNode>): void {
  const queue = [node];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const childId of current.dependents) {
      const child = graph.get(childId);
      if (!child) continue;
      if (child.step.status !== "pending") continue;
      child.step.status = "blocked";
      queue.push(child);
    }
  }
}

export interface StepNode {
  step: PlanStepRecord;
  dependsOn: string[];
  dependents: string[];
  unresolvedDeps: number;
}

export function safeParseDepends(dependsOn: unknown): string[] {
  if (typeof dependsOn === "string") {
    try {
      const parsed: unknown = JSON.parse(dependsOn);
      if (Array.isArray(parsed)) {
        const result: string[] = parsed.filter((d): d is string => typeof d === "string");
        return result;
      }
    } catch {
      return [];
    }
  }
  if (Array.isArray(dependsOn)) return dependsOn.filter((d): d is string => typeof d === "string");
  return [];
}

export function computeLevels(graph: Map<string, StepNode>): StepNode[][] {
  const levels: StepNode[][] = [];
  const ready = new Set<StepNode>();
  const visited = new Set<string>();

  for (const node of graph.values()) {
    if (node.unresolvedDeps === 0) {
      ready.add(node);
    }
  }

  while (ready.size > 0) {
    const level = [...ready];
    levels.push(level);
    ready.clear();

    for (const node of level) {
      visited.add(node.step.id);

      for (const childId of node.dependents) {
        const child = graph.get(childId);
        if (!child) continue;

        child.unresolvedDeps--;

        if (child.unresolvedDeps === 0 && !visited.has(child.step.id)) {
          ready.add(child);
        }
      }
    }
  }

  if (levels.flat().length !== graph.size) {
    throw new Error("Cyclic or unresolved DAG detected");
  }

  return levels;
}

export function buildGraph(steps: PlanStepRecord[]): Map<string, StepNode> {
  const nodeMap = new Map<string, StepNode>();

  for (const step of steps) {
    nodeMap.set(step.id, {
      step,
      dependsOn: safeParseDepends(step.dependsOn),
      dependents: [],
      unresolvedDeps: 0,
    });
  }

  for (const node of nodeMap.values()) {
    for (const depId of node.dependsOn) {
      const depNode = nodeMap.get(depId);
      if (!depNode) continue;
      depNode.dependents.push(node.step.id);
    }
  }

  for (const node of nodeMap.values()) {
    let count = 0;
    for (const depId of node.dependsOn) {
      if (nodeMap.has(depId)) count++;
    }
    node.unresolvedDeps = count;
  }

  return nodeMap;
}

export class WorkflowExecutor {
  private readonly tools: Map<string, Tool>;
  private readonly emit: (event: AgentEvent) => void;
  private readonly planParallelism: number;
  private readonly callbacks?: WorkflowCallbacks;

  constructor(opts: {
    tools: Map<string, Tool>;
    emit: (event: AgentEvent) => void;
    planParallelism?: number;
    callbacks?: WorkflowCallbacks;
  }) {
    this.tools = opts.tools;
    this.emit = opts.emit;
    this.planParallelism = opts.planParallelism ?? getConfig().PLAN_PARALLELISM;
    this.callbacks = opts.callbacks;
  }

  async execute(
    plan: PlanRecord & { steps: PlanStepRecord[] },
    signal?: AbortSignal,
  ): Promise<WorkflowResult> {
    const startTime = Date.now();

    const graph = buildGraph(plan.steps);
    let levels: StepNode[][];

    try {
      levels = computeLevels(graph);
    } catch {
      return {
        planId: plan.id,
        status: "failed",
        completedSteps: 0,
        failedSteps: 0,
        executionTimeMs: Date.now() - startTime,
        results: [],
      };
    }

    const allResults: StepResult[] = [];
    let workflowFailed = false;

    const executor = new ParallelExecutor({ concurrency: this.planParallelism });

    for (const level of levels) {
      if (signal?.aborted) {
        allResults.push(...this.cancelRemaining(levels, levels.indexOf(level)));
        workflowFailed = true;
        break;
      }

      const toExecute: StepNode[] = [];
      for (const node of level) {
        if (node.step.status === "completed") {
          allResults.push({ stepId: node.step.id, status: "completed", result: node.step.result ?? "", durationMs: 0 });
          fireAndForget(() => this.callbacks?.onStepCompleted?.(node.step.id, node.step.result ?? ""));
        } else if (node.step.status === "failed") {
          allResults.push({ stepId: node.step.id, status: "failed", error: node.step.error ?? "unknown error", durationMs: 0 });
          fireAndForget(() => this.callbacks?.onStepFailed?.(node.step.id, node.step.error ?? "unknown error"));
          const failedNode = graph.get(node.step.id);
          if (failedNode) markBlockedTransitive(failedNode, graph);
        } else if (node.step.status === "blocked") {
          allResults.push({ stepId: node.step.id, status: "blocked", reason: "dependency_failed", durationMs: 0 });
        } else if (node.step.status === "skipped") {
          allResults.push({ stepId: node.step.id, status: "skipped", reason: "previously_skipped", durationMs: 0 });
          fireAndForget(() => this.callbacks?.onStepSkipped?.(node.step.id));
        } else {
          toExecute.push(node);
        }
      }

      if (toExecute.length === 0) continue;

      try {
        const tasks = toExecute.map((node) => ({
          label: node.step.id,
          execute: async (): Promise<StepResult> => {
            try {
              this.emitPlanStepStarted(node.step, plan.id);
              fireAndForget(() => this.callbacks?.onStepRunning?.(node.step.id));
              return await executePlanStep(node.step, this.tools, { sessionId: plan.sessionId, signal });
            } catch {
              return { stepId: node.step.id, status: "failed", error: "Unexpected step execution error", durationMs: 0 };
            }
          },
        }));

        const levelResults = await executor.runAll(tasks, signal);
        allResults.push(...levelResults);

        for (const result of levelResults) {
          if (result.status === "completed") {
            this.emitPlanStepCompleted(result, plan.id);
            fireAndForget(() => this.callbacks?.onStepCompleted?.(result.stepId, result.result));
          } else if (result.status === "failed") {
            this.emitPlanStepFailed(result, plan.id);
            fireAndForget(() => this.callbacks?.onStepFailed?.(result.stepId, result.error));
            const node = graph.get(result.stepId);
            if (node) markBlockedTransitive(node, graph);
          }
        }

        if (levelResults.every((r) => r.status === "failed")) {
          allResults.push(...this.blockRemaining(levels, levels.indexOf(level) + 1));
          workflowFailed = true;
          break;
        }
      } catch {
        allResults.push(...this.cancelRemaining(levels, levels.indexOf(level)));
        workflowFailed = true;
        break;
      }
    }

    const executionTimeMs = Date.now() - startTime;
    const completedSteps = allResults.filter((r) => r.status === "completed").length;
    const failedSteps = allResults.filter((r) => r.status === "failed").length;
    workflowFailed = workflowFailed || failedSteps > 0;

    if (workflowFailed) {
      this.emitWorkflowFailed(plan.id, plan.sessionId, allResults.length);
    } else {
      this.emitWorkflowCompleted(plan.id, plan.sessionId, allResults.length);
    }

    return {
      planId: plan.id,
      status: workflowFailed ? "failed" : "completed",
      completedSteps,
      failedSteps,
      executionTimeMs,
      results: allResults,
    };
  }

  private emitPlanStepStarted(step: PlanStepRecord, planId: string): void {
    this.emit({
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "plan_step_started",
      planId,
      stepId: step.id,
      description: step.description,
      ...(step.tool ? { tool: step.tool } : {}),
    });
  }

  private emitPlanStepCompleted(result: StepResult & { status: "completed" }, planId: string): void {
    this.emit({
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "plan_step_completed",
      planId,
      stepId: result.stepId,
      result: result.result,
    });
  }

  private emitPlanStepFailed(result: StepResult & { status: "failed" }, planId: string): void {
    this.emit({
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "plan_step_failed",
      planId,
      stepId: result.stepId,
      error: result.error,
    });
  }

  private emitWorkflowCompleted(planId: string, sessionId: string, stepCount: number): void {
    this.emit({
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "workflow_completed",
      planId,
      sessionId,
      stepCount,
    });
  }

  private emitWorkflowFailed(planId: string, sessionId: string, stepCount: number): void {
    this.emit({
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "workflow_failed",
      planId,
      sessionId,
      error: "Workflow execution failed",
      stepCount,
    });
  }

  private cancelRemaining(levels: StepNode[][], fromLevel: number): StepResult[] {
    const results: StepResult[] = [];
    for (let i = fromLevel; i < levels.length; i++) {
      for (const node of levels[i]) {
        fireAndForget(() => this.callbacks?.onStepSkipped?.(node.step.id));
        results.push({ stepId: node.step.id, status: "skipped", reason: "cancelled", durationMs: 0 });
      }
    }
    return results;
  }

  private blockRemaining(levels: StepNode[][], fromLevel: number): StepResult[] {
    const results: StepResult[] = [];
    for (let i = fromLevel; i < levels.length; i++) {
      for (const node of levels[i]) {
        if (node.step.status === "blocked") {
          fireAndForget(() => this.callbacks?.onStepBlocked?.(node.step.id));
          results.push({ stepId: node.step.id, status: "blocked", reason: "dependency_failed", durationMs: 0 });
        } else {
          fireAndForget(() => this.callbacks?.onStepSkipped?.(node.step.id));
          results.push({ stepId: node.step.id, status: "skipped", reason: "workflow_failed", durationMs: 0 });
        }
      }
    }
    return results;
  }
}
