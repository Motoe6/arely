import {
  createPipelineStepRun,
  updatePipelineStepRunStatus,
  appendPipelineStepRunLog,
  updatePipelineRunStatus,
} from "./pipeline-store.js";
import type { PipelineStepRecord } from "./pipeline-store.js";
import { getDb } from "../persistence/database.js";
import { pipelineRuns } from "../persistence/schema.js";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { classifyExecutionError } from "./error-classifier.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stepRunKey(stepId: string, retryCount: number): string {
  return `${stepId}::r${retryCount}`;
}

export interface ExecutionTracer {
  onRunStart(pipelineId: string, runId: string, stepsTotal: number): void;
  onStepStart(runId: string, step: PipelineStepRecord, input: string, retryCount?: number): void;
  onStepComplete(runId: string, stepId: string, output: string, retryCount?: number): void;
  onStepFail(runId: string, stepId: string, error: string, retryCount?: number): void;
  onStepSkip(runId: string, stepId: string, reason: string): void;
  onStepLog(runId: string, stepId: string, message: string, retryCount?: number): void;
  onRunComplete(runId: string, status: "completed" | "failed"): void;
}

export function createExecutionTracer(): ExecutionTracer {
  return new DbExecutionTracer();
}

class DbExecutionTracer implements ExecutionTracer {
  private stepRunIds = new Map<string, string>();

  onRunStart(pipelineId: string, runId: string, stepsTotal: number): void {
    updatePipelineRunStatus(runId, "running");
    getDb().update(pipelineRuns).set({ stepsTotal }).where(eq(pipelineRuns.id, runId)).run();
  }

  onStepStart(runId: string, step: PipelineStepRecord, input: string, retryCount = 0): void {
    const record = createPipelineStepRun({
      runId,
      stepId: step.id,
      stepType: step.type,
      agentId: step.type === "agent" ? step.agentId : null,
      toolName: step.type === "tool" ? step.toolName : null,
      input,
      toolInputHash: sha256(input),
      retryCount,
    });
    this.stepRunIds.set(stepRunKey(step.id, retryCount), record.id);
  }

  onStepComplete(runId: string, stepId: string, output: string, retryCount = 0): void {
    const id = this.stepRunIds.get(stepRunKey(stepId, retryCount));
    if (!id) return;
    updatePipelineStepRunStatus(id, "completed", { output, toolOutputHash: sha256(output) });
  }

  onStepFail(runId: string, stepId: string, error: string, retryCount = 0): void {
    const id = this.stepRunIds.get(stepRunKey(stepId, retryCount));
    if (!id) return;
    const errorKind = classifyExecutionError(error);
    updatePipelineStepRunStatus(id, "failed", { error, errorKind });
  }

  onStepSkip(runId: string, stepId: string, reason: string): void {
    const id = this.stepRunIds.get(stepRunKey(stepId, 0));
    if (!id) return;
    updatePipelineStepRunStatus(id, "skipped", { error: reason });
  }

  onStepLog(runId: string, stepId: string, message: string, retryCount = 0): void {
    const id = this.stepRunIds.get(stepRunKey(stepId, retryCount));
    if (!id) return;
    appendPipelineStepRunLog(id, message);
  }

  onRunComplete(runId: string, status: "completed" | "failed"): void {
    updatePipelineRunStatus(runId, status);
  }
}
