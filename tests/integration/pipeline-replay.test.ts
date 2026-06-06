import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createPipeline, createPipelineStep, createPipelineRun, updatePipelineRunStatus, getPipelineRun, getPipelineStepRuns, getPipelineRuns } from "@opencode/engine/agents/pipeline-store.js";
import { executePipeline } from "@opencode/engine/agents/pipeline.js";
import { getDb } from "@opencode/engine/persistence/database.js";
import { agents, pipelineStepRuns, pipelineRuns, pipelineSteps, agentPipelines } from "@opencode/engine/persistence/schema.js";
import type { RuntimeConfig } from "@opencode/engine/agents/runtime.js";
import { createExecutionTracer } from "@opencode/engine/agents/execution-tracer.js";

function createTestAgent(id: string): void {
  const now = new Date().toISOString();
  getDb().insert(agents).values({
    id, name: id, goal: `Test agent ${id}`, mode: "planning",
    trigger: "manual", enabled: 1, createdAt: now, updatedAt: now,
  }).run();
}

describe("Pipeline Replay Integration", () => {
  beforeAll(() => {
    initTestDb();
    createTestAgent("replay-tool-agent");
  });

  afterAll(() => cleanupTestDb());

  beforeEach(() => {
    const db = getDb();
    db.delete(pipelineStepRuns).run();
    db.delete(pipelineRuns).run();
    db.delete(pipelineSteps).run();
    db.delete(agentPipelines).run();
  });

  function makeToolConfig(outputs: Record<string, string>): RuntimeConfig {
    const captured: string[] = [];
    return {
      sessionManager: {} as any,
      llm: {} as any,
      executeTool: async (toolName: string, _args: Record<string, unknown>) => {
        captured.push(toolName);
        const result = outputs[toolName] ?? `default-${toolName}`;
        return { content: result };
      },
      _captured: captured,
    } as RuntimeConfig & { _captured: string[] };
  }

  function insertOriginalStepRun(runId: string, stepId: string, status: string, output: string | null, order: number): void {
    const time = new Date(Date.now() + order * 1000).toISOString();
    getDb().insert(pipelineStepRuns).values({
      id: `orig-${stepId}`,
      runId,
      stepId,
      stepType: "tool",
      agentId: null,
      toolName: "test_tool",
      status,
      input: '{}',
      output,
      error: status === "failed" ? "error" : null,
      startedAt: time,
      finishedAt: status !== "running" ? time : null,
      retryCount: 0,
      log: "[]",
    }).run();
  }

  it("should skip steps before replayFrom and re-execute from that point", async () => {
    const pipeline = createPipeline({ name: "Replay Skip Test" });
    const step1 = createPipelineStep({ pipelineId: pipeline.id, agentId: null, toolName: "tool_a", stepOrder: 0, type: "tool", dependsOn: "[]", inputMapping: null, outputKey: null });
    const step2 = createPipelineStep({ pipelineId: pipeline.id, agentId: null, toolName: "tool_b", stepOrder: 1, type: "tool", dependsOn: JSON.stringify([step1.id]), inputMapping: null, outputKey: null });
    const step3 = createPipelineStep({ pipelineId: pipeline.id, agentId: null, toolName: "tool_c", stepOrder: 2, type: "tool", dependsOn: JSON.stringify([step2.id]), inputMapping: null, outputKey: null });

    const originalRun = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 3 });
    updatePipelineRunStatus(originalRun.id, "completed");
    insertOriginalStepRun(originalRun.id, step1.id, "completed", "cached-output-1", 0);
    insertOriginalStepRun(originalRun.id, step2.id, "completed", "cached-output-2", 1);
    insertOriginalStepRun(originalRun.id, step3.id, "completed", "cached-output-3", 2);

    const toolOutputs: Record<string, string> = {
      tool_c: "fresh-output-c",
    };
    const config = makeToolConfig(toolOutputs);

    const tracer = createExecutionTracer();
    const result = await executePipeline(pipeline.id, config, tracer, {
      replayFrom: step3.id,
      replayOf: originalRun.id,
      snapshot: {
        stepOutputs: new Map([
          [step1.id, "cached-output-1"],
          [step2.id, "cached-output-2"],
        ]),
        stepStates: new Map([
          [step1.id, "completed"],
          [step2.id, "completed"],
          [step3.id, "completed"],
        ]),
      },
    });

    expect(result.ok).toBe(true);
    expect(config._captured).toEqual(["tool_c"]);
    expect(result.stepResults).toHaveLength(3);
    expect(result.stepResults[0].status).toBe("completed");
    expect(result.stepResults[1].status).toBe("completed");
    expect(result.stepResults[2].status).toBe("completed");

    const replayRun = getPipelineRun(result.runId);
    expect(replayRun).toBeDefined();
    expect(replayRun!.replayOf).toBe(originalRun.id);
  });

  it("should propagate failures from original run when replaying from a point after the failure", async () => {
    const pipeline = createPipeline({ name: "Replay Failure Test" });
    const step1 = createPipelineStep({ pipelineId: pipeline.id, agentId: null, toolName: "tool_a", stepOrder: 0, type: "tool", dependsOn: "[]", inputMapping: null, outputKey: null });
    const step2 = createPipelineStep({ pipelineId: pipeline.id, agentId: null, toolName: "tool_b", stepOrder: 1, type: "tool", dependsOn: JSON.stringify([step1.id]), inputMapping: null, outputKey: null });
    const step3 = createPipelineStep({ pipelineId: pipeline.id, agentId: null, toolName: "tool_c", stepOrder: 2, type: "tool", dependsOn: JSON.stringify([step1.id]), inputMapping: null, outputKey: null });

    const originalRun = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 3 });
    updatePipelineRunStatus(originalRun.id, "failed");
    insertOriginalStepRun(originalRun.id, step1.id, "completed", "output-1", 0);
    insertOriginalStepRun(originalRun.id, step2.id, "failed", null, 1);
    insertOriginalStepRun(originalRun.id, step3.id, "completed", "output-3", 2);

    const config = makeToolConfig({ tool_c: "fresh-c" });

    const result = await executePipeline(pipeline.id, config, undefined, {
      replayFrom: step3.id,
      replayOf: originalRun.id,
      snapshot: {
        stepOutputs: new Map([
          [step1.id, "output-1"],
          [step3.id, "output-3"],
        ]),
        stepStates: new Map([
          [step1.id, "completed"],
          [step2.id, "failed"],
          [step3.id, "completed"],
        ]),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stepResults[0].status).toBe("completed");
    expect(result.stepResults[1].status).toBe("failed");
    expect(result.stepResults[1].error).toBe("Failed in original run");
    expect(result.stepResults[2].status).toBe("completed");
    expect(config._captured).toEqual(["tool_c"]);
  });

  it("should re-execute tool after replayFrom when original was successful", async () => {
    const pipeline = createPipeline({ name: "Replay Re-execute Test" });
    const step1 = createPipelineStep({ pipelineId: pipeline.id, agentId: null, toolName: "tool_x", stepOrder: 0, type: "tool", dependsOn: "[]", inputMapping: null, outputKey: null });
    const step2 = createPipelineStep({ pipelineId: pipeline.id, agentId: null, toolName: "tool_y", stepOrder: 1, type: "tool", dependsOn: JSON.stringify([step1.id]), inputMapping: null, outputKey: null });

    const originalRun = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 2 });
    updatePipelineRunStatus(originalRun.id, "failed");
    insertOriginalStepRun(originalRun.id, step1.id, "completed", "old-x", 0);
    insertOriginalStepRun(originalRun.id, step2.id, "failed", null, 1);

    const config = makeToolConfig({ tool_y: "new-y" });

    const tracer = createExecutionTracer();
    const result = await executePipeline(pipeline.id, config, tracer, {
      replayFrom: step2.id,
      replayOf: originalRun.id,
      snapshot: {
        stepOutputs: new Map([[step1.id, "old-x"]]),
        stepStates: new Map([
          [step1.id, "completed"],
          [step2.id, "failed"],
        ]),
      },
    });

    expect(result.ok).toBe(true);
    expect(config._captured).toEqual(["tool_y"]);
    expect(result.stepResults[1].status).toBe("completed");
  });

  it("should correctly set replayOf on the new run", async () => {
    const pipeline = createPipeline({ name: "Replay Linkage Test" });
    const step1 = createPipelineStep({ pipelineId: pipeline.id, agentId: null, toolName: "tool_a", stepOrder: 0, type: "tool", dependsOn: "[]", inputMapping: null, outputKey: null });

    const originalRun = createPipelineRun({ pipelineId: pipeline.id, stepsTotal: 1 });
    updatePipelineRunStatus(originalRun.id, "completed");
    insertOriginalStepRun(originalRun.id, step1.id, "completed", "output", 0);

    const config = makeToolConfig({ tool_a: "fresh" });
    const result = await executePipeline(pipeline.id, config, undefined, {
      replayFrom: step1.id,
      replayOf: originalRun.id,
      snapshot: {
        stepOutputs: new Map(),
        stepStates: new Map([[step1.id, "completed"]]),
      },
    });

    const replayRun = getPipelineRun(result.runId);
    expect(replayRun!.replayOf).toBe(originalRun.id);
  });
});
