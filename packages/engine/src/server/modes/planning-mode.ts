import { ulid } from "ulid";
import { createPlan as createExecutionPlan } from "../../planner/planner.js";
import { WorkflowExecutor, type WorkflowCallbacks } from "../../planner/workflow.js";
import type { StepResult } from "../../planner/executor.js";
import { Synthesizer } from "../../planner/synthesizer.js";
import {
  createPlan as persistPlan,
  createSteps,
  updatePlanStatus,
  markStepRunning,
  markStepCompleted,
  markStepFailed,
  markStepBlocked,
  markStepSkipped,
} from "../../persistence/plan-store.js";
import type { PlanStepRecord, StepExecutionResult } from "../../types.js";
import type { ExecutionMode, ExecutionResult } from "../execution-mode.js";
import type { AgentSession } from "../session.js";

function toStepExecutionResults(
  results: StepResult[],
  steps: PlanStepRecord[],
): StepExecutionResult[] {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  return results.map((r) => ({
    stepId: r.stepId,
    description: stepMap.get(r.stepId)?.description ?? "",
    tool: stepMap.get(r.stepId)?.tool ?? undefined,
    result: r.status === "completed" ? r.result : null,
    error: r.status === "failed" ? r.error : undefined,
    durationMs: r.durationMs,
  }));
}

export class PlanningModeExecution implements ExecutionMode {
  readonly name = "planning";

  async run(session: AgentSession, input: string): Promise<ExecutionResult> {
    if (session.abortSignal.aborted) {
      return { content: "Plan cancelled", turns: 0 };
    }

    const planned = await createExecutionPlan(input, session.llm, session.tools, {
      sessionId: session.id,
      signal: session.abortSignal,
    });

    if (!planned.ok) {
      const errorMsg = planned.error;
      session.sse.emit(session.id, {
        id: ulid(),
        version: 1,
        timestamp: Date.now(),
        type: "workflow_failed" as const,
        planId: "",
        sessionId: session.id,
        error: errorMsg,
        stepCount: 0,
      });
      session.messages.push({ role: "assistant" as const, content: errorMsg, timestamp: Date.now() });
      return { content: errorMsg, turns: 0 };
    }

    const plan = persistPlan({ id: planned.plan.id, sessionId: session.id, goal: input });
    const steps = createSteps(
      planned.steps.map((s) => ({
        id: s.id,
        planId: s.planId,
        description: s.description,
        tool: s.tool,
        args: s.args,
        dependsOn: s.dependsOn,
        order: s.order,
      })),
    );

    updatePlanStatus(plan.id, "executing");

    const callbacks: WorkflowCallbacks = {
      onStepRunning: (stepId) => { markStepRunning(stepId); },
      onStepCompleted: (stepId, result) => { markStepCompleted(stepId, result); },
      onStepFailed: (stepId, error) => { markStepFailed(stepId, error); },
      onStepBlocked: (stepId) => { markStepBlocked(stepId); },
      onStepSkipped: (stepId) => { markStepSkipped(stepId); },
    };

    const executor = new WorkflowExecutor({
      tools: session.tools,
      emit: (event) => { session.sse.emit(session.id, event); },
      callbacks,
    });

    const wfResult = await executor.execute(
      { ...plan, steps },
      session.abortSignal,
    );

    updatePlanStatus(plan.id, wfResult.status === "completed" ? "completed" : "failed");

    const completedResults = wfResult.results.filter((r) => r.status === "completed");
    const adapted = toStepExecutionResults(completedResults, steps);

    const synthesizer = new Synthesizer();
    const synthesis = await synthesizer.synthesize(input, adapted, session.llm, session.abortSignal);

    const response = synthesis.ok ? synthesis.response : "Workflow completed. Review the results above.";
    session.messages.push({ role: "assistant", content: response, timestamp: Date.now() });

    return { content: response, turns: 1 };
  }
}
