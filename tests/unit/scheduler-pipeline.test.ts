import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { AgentScheduler } from "@arely/engine/agents/scheduler.js";
import { createPipeline, createPipelineStep, getPipelineRuns } from "@arely/engine/agents/pipeline-store.js";

vi.mock("@arely/engine/agents/runtime.js", () => ({
  executeAgent: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@arely/engine/agents/pipeline.js", () => ({
  executePipeline: vi.fn().mockResolvedValue({ ok: true, runId: "mock-run", stepResults: [] }),
}));

import { executePipeline } from "@arely/engine/agents/pipeline.js";
import { ulid } from "ulid";
import { getDb } from "@arely/engine/persistence/database.js";
import { agents, agentPipelines, pipelineSteps, pipelineRuns } from "@arely/engine/persistence/schema.js";

const mockConfig = {
  sessionManager: {} as any,
  llm: {} as any,
};

function createPipelineAgent(name: string, pipelineId: string): string {
  const id = ulid();
  const now = new Date().toISOString();
  getDb().insert(agents).values({
    id,
    name,
    goal: `Pipeline agent ${name}`,
    mode: "planning",
    trigger: "pipeline",
    triggerConfig: JSON.stringify({ pipelineId }),
    enabled: 1,
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

describe("Scheduler Pipeline Trigger", () => {
  let scheduler: AgentScheduler;

  beforeAll(() => initTestDb());
  afterAll(() => cleanupTestDb());

  beforeEach(() => {
    vi.clearAllMocks();
    const db = getDb();
    db.delete(pipelineRuns).run();
    db.delete(pipelineSteps).run();
    db.delete(agentPipelines).run();
    db.delete(agents).run();
    scheduler = new AgentScheduler(mockConfig, 1000);
  });

  afterEach(() => {
    scheduler.stop();
  });

  it("should execute pipeline when agent trigger is pipeline", async () => {
    const pipeline = createPipeline({ name: "Scheduler Pipeline" });
    const agentId = createPipelineAgent("Pipeline Agent", pipeline.id);

    scheduler.start();
    await vi.waitFor(() => {
      expect(executePipeline).toHaveBeenCalledWith(pipeline.id, mockConfig, undefined);
    }, { timeout: 2000 });
    scheduler.stop();
  });

  it("should warn and skip when pipeline config is missing pipelineId", async () => {
    const id = ulid();
    const now = new Date().toISOString();
    getDb().insert(agents).values({
      id,
      name: "Bad Pipeline Agent",
      goal: "test",
      mode: "planning",
      trigger: "pipeline",
      triggerConfig: "{}",
      enabled: 1,
      createdAt: now,
      updatedAt: now,
    }).run();

    scheduler.start();
    // Should not call executePipeline since pipelineId is missing
    await new Promise((r) => setTimeout(r, 100));
    expect(executePipeline).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("should skip pipeline agent when triggerConfig is invalid JSON", async () => {
    const id = ulid();
    const now = new Date().toISOString();
    getDb().insert(agents).values({
      id,
      name: "Invalid Config Agent",
      goal: "test",
      mode: "planning",
      trigger: "pipeline",
      triggerConfig: "not-json",
      enabled: 1,
      createdAt: now,
      updatedAt: now,
    }).run();

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(executePipeline).not.toHaveBeenCalled();
    scheduler.stop();
  });
});
