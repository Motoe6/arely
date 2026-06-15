import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { getDb } from "@arely/engine/persistence/database.js";
import { agents } from "@arely/engine/persistence/schema.js";
import {
  createPipeline,
  getPipeline,
  listPipelines,
  deletePipeline,
  createPipelineStep,
  getPipelineSteps,
  deletePipelineSteps,
  createPipelineRun,
  updatePipelineRunStatus,
  getPipelineRun,
  getPipelineRuns,
} from "@arely/engine/agents/pipeline-store.js";

function createTestAgent(id: string): void {
  const now = new Date().toISOString();
  getDb().insert(agents).values({
    id, name: id, goal: `Test agent ${id}`, mode: "planning",
    trigger: "manual", enabled: 1, createdAt: now, updatedAt: now,
  }).run();
}

describe("Pipeline Store", () => {
  beforeAll(() => {
    initTestDb();
    createTestAgent("agent-1");
    createTestAgent("agent-2");
  });
  afterAll(() => cleanupTestDb());

  describe("Pipelines", () => {
    it("should create and get a pipeline", () => {
      const pipeline = createPipeline({ name: "Test Pipeline", description: "A test pipeline" });
      expect(pipeline.id).toBeTruthy();
      expect(pipeline.name).toBe("Test Pipeline");
      expect(pipeline.description).toBe("A test pipeline");

      const fetched = getPipeline(pipeline.id);
      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe("Test Pipeline");
    });

    it("should list all pipelines", () => {
      createPipeline({ name: "Pipeline A" });
      createPipeline({ name: "Pipeline B" });
      const all = listPipelines();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it("should delete a pipeline", () => {
      const pipeline = createPipeline({ name: "To Delete" });
      expect(deletePipeline(pipeline.id)).toBe(true);
      expect(getPipeline(pipeline.id)).toBeUndefined();
    });

    it("should return false when deleting nonexistent pipeline", () => {
      expect(deletePipeline("nonexistent")).toBe(false);
    });
  });

  describe("Pipeline Steps", () => {
    it("should create and get steps for a pipeline", () => {
      const pipeline = createPipeline({ name: "Steps Test" });
      const step1 = createPipelineStep({
        pipelineId: pipeline.id,
        agentId: "agent-1",
        stepOrder: 0,
        dependsOn: "[]",
        inputMapping: null,
        outputKey: "research_output",
      });
      const step2 = createPipelineStep({
        pipelineId: pipeline.id,
        agentId: "agent-2",
        stepOrder: 1,
        dependsOn: JSON.stringify([step1.id]),
        inputMapping: JSON.stringify({ input_data: step1.id }),
        outputKey: "content_output",
      });

      expect(step1.agentId).toBe("agent-1");
      expect(step2.agentId).toBe("agent-2");
      expect(step2.stepOrder).toBe(1);

      const steps = getPipelineSteps(pipeline.id);
      expect(steps).toHaveLength(2);
      expect(steps[0].stepOrder).toBe(0);
      expect(steps[1].stepOrder).toBe(1);
    });

    it("should create step with contract fields and read them back", () => {
      const pipeline = createPipeline({ name: "Contract Test" });
      const step = createPipelineStep({
        pipelineId: pipeline.id,
        agentId: "agent-1",
        stepOrder: 0,
        timeoutMs: 5000,
        retries: 2,
        retryDelayMs: 1000,
        idempotent: true,
        retryableErrors: ["timeout", "tool_error"],
      });

      expect(step.timeoutMs).toBe(5000);
      expect(step.retries).toBe(2);
      expect(step.retryDelayMs).toBe(1000);
      expect(step.idempotent).toBe(true);
      expect(step.retryableErrors).toEqual(["timeout", "tool_error"]);

      const steps = getPipelineSteps(pipeline.id);
      expect(steps).toHaveLength(1);
      expect(steps[0].timeoutMs).toBe(5000);
      expect(steps[0].retries).toBe(2);
      expect(steps[0].retryableErrors).toEqual(["timeout", "tool_error"]);
      expect(steps[0].idempotent).toBe(true);
    });

    it("should reject invalid contract field values", () => {
      const pipeline = createPipeline({ name: "Validation" });
      expect(() => createPipelineStep({ pipelineId: pipeline.id, agentId: "agent-1", stepOrder: 0, timeoutMs: 0 })).toThrow("timeoutMs must be > 0");
      expect(() => createPipelineStep({ pipelineId: pipeline.id, agentId: "agent-1", stepOrder: 0, retries: -1 })).toThrow("retries must be >= 0");
      expect(() => createPipelineStep({ pipelineId: pipeline.id, agentId: "agent-1", stepOrder: 0, retryDelayMs: -1 })).toThrow("retryDelayMs must be >= 0");
      expect(() => createPipelineStep({ pipelineId: pipeline.id, agentId: "agent-1", stepOrder: 0, retryableErrors: ["bogus" as "timeout"] })).toThrow("Invalid retryableError");
    });

    it("should default contract fields to null when omitted", () => {
      const pipeline = createPipeline({ name: "No Contract" });
      const step = createPipelineStep({
        pipelineId: pipeline.id,
        agentId: "agent-1",
        stepOrder: 0,
      });

      expect(step.timeoutMs).toBeNull();
      expect(step.retries).toBeNull();
      expect(step.retryDelayMs).toBeNull();
      expect(step.idempotent).toBeNull();
      expect(step.retryableErrors).toBeNull();

      const steps = getPipelineSteps(pipeline.id);
      expect(steps[0].timeoutMs).toBeNull();
      expect(steps[0].retries).toBeNull();
    });

    it("should delete all steps for a pipeline", () => {
      const pipeline = createPipeline({ name: "Delete Steps" });
      createPipelineStep({ pipelineId: pipeline.id, agentId: "agent-1", stepOrder: 0, dependsOn: "[]", inputMapping: null, outputKey: null });
      createPipelineStep({ pipelineId: pipeline.id, agentId: "agent-2", stepOrder: 1, dependsOn: "[]", inputMapping: null, outputKey: null });

      deletePipelineSteps(pipeline.id);
      const steps = getPipelineSteps(pipeline.id);
      expect(steps).toHaveLength(0);
    });
  });

  describe("Pipeline Runs", () => {
    it("should create and track a run", () => {
      const pipeline = createPipeline({ name: "Run Test" });
      const run = createPipelineRun({ pipelineId: pipeline.id });
      expect(run.status).toBe("pending");
      expect(run.pipelineId).toBe(pipeline.id);
      expect(run.startedAt).toBeTruthy();
      expect(run.completedAt).toBeNull();
    });

    it("should update run status", () => {
      const pipeline = createPipeline({ name: "Status Test" });
      const run = createPipelineRun({ pipelineId: pipeline.id });

      updatePipelineRunStatus(run.id, "running");
      const runningRun = getPipelineRun(run.id);
      expect(runningRun!.status).toBe("running");
      expect(runningRun!.startedAt).toBeTruthy();

      updatePipelineRunStatus(run.id, "completed");
      const completedRun = getPipelineRun(run.id);
      expect(completedRun!.status).toBe("completed");
      expect(completedRun!.completedAt).toBeTruthy();
    });

    it("should list runs by pipeline", () => {
      const pipeline = createPipeline({ name: "List Runs" });
      createPipelineRun({ pipelineId: pipeline.id });
      createPipelineRun({ pipelineId: pipeline.id });

      const runs = getPipelineRuns(pipeline.id);
      expect(runs.length).toBeGreaterThanOrEqual(2);
    });
  });
});
