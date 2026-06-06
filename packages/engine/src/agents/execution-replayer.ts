import { getPipelineRun, getPipelineStepRuns, getPipelineSteps } from "./pipeline-store.js";
import { executePipeline, type ExecutionSnapshot, type PipelineExecutionResult } from "./pipeline.js";
import type { RuntimeConfig } from "./runtime.js";
import type { ExecutionTracer } from "./execution-tracer.js";

export class ExecutionReplayer {
  async replay(
    pipelineId: string,
    originalRunId: string,
    replayFrom: string,
    config: RuntimeConfig,
    tracer?: ExecutionTracer,
  ): Promise<PipelineExecutionResult> {
    const originalRun = getPipelineRun(originalRunId);
    if (!originalRun) {
      return { ok: false, error: `Original run not found: ${originalRunId}`, runId: "", stepResults: [] };
    }

    const steps = getPipelineSteps(pipelineId);
    const originalStepRuns = getPipelineStepRuns(originalRunId);
    const stepStates: ExecutionSnapshot["stepStates"] = new Map();
    const stepOutputs: ExecutionSnapshot["stepOutputs"] = new Map();
    const stepMap = new Map(steps.map((s) => [s.id, s]));

    if (!stepMap.has(replayFrom)) {
      return { ok: false, error: `Replay point step not found in pipeline: ${replayFrom}`, runId: "", stepResults: [] };
    }

    for (const stepRun of originalStepRuns) {
      if (stepRun.status === "completed") {
        stepStates.set(stepRun.stepId, "completed");
        if (stepRun.output !== null) {
          stepOutputs.set(stepRun.stepId, stepRun.output);
        }
      } else if (stepRun.status === "failed") {
        stepStates.set(stepRun.stepId, "failed");
      } else if (stepRun.status === "skipped") {
        stepStates.set(stepRun.stepId, "skipped");
      }
    }

    const snapshot: ExecutionSnapshot = { stepOutputs, stepStates };

    return executePipeline(pipelineId, config, tracer, {
      replayFrom,
      replayOf: originalRunId,
      snapshot,
    });
  }
}
