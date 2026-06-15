import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import type { AgentDefinition } from "@arelyos/engine/agents/types.js";

const testAgent: AgentDefinition = {
  name: "Reddit Trends",
  description: "Monitors trending AI topics",
  goal: "Find trending AI topics on Reddit",
  mode: "planning",
  trigger: "interval",
  triggerConfig: JSON.stringify({ intervalMs: 300000 }),
  enabled: true,
};

describe("AgentStore", () => {
  let store: typeof import("@arelyos/engine/agents/agent-store.js");

  beforeEach(async () => {
    initTestDb();
    store = await import("@arelyos/engine/agents/agent-store.js");
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("createAgent inserts and returns the agent", () => {
    const agent = store.createAgent(testAgent);
    expect(agent.id).toBeTruthy();
    expect(agent.name).toBe("Reddit Trends");
    expect(agent.goal).toBe("Find trending AI topics on Reddit");
    expect(agent.trigger).toBe("interval");
    expect(agent.enabled).toBe(true);
    expect(agent.createdAt).toBeTruthy();
  });

  it("getAgent returns undefined for missing id", () => {
    const agent = store.getAgent("nonexistent");
    expect(agent).toBeUndefined();
  });

  it("getAgent returns the stored agent", () => {
    const created = store.createAgent(testAgent);
    const fetched = store.getAgent(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.name).toBe("Reddit Trends");
  });

  it("updateAgent modifies fields and returns updated agent", () => {
    const created = store.createAgent(testAgent);
    const updated = store.updateAgent(created.id, { name: "AI Trends 2.0", enabled: false });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("AI Trends 2.0");
    expect(updated!.enabled).toBe(false);
    expect(updated!.goal).toBe("Find trending AI topics on Reddit");
  });

  it("updateAgent returns undefined for missing id", () => {
    const result = store.updateAgent("nonexistent", { name: "Nope" });
    expect(result).toBeUndefined();
  });

  it("deleteAgent removes the agent", () => {
    const created = store.createAgent(testAgent);
    const deleted = store.deleteAgent(created.id);
    expect(deleted).toBe(true);
    expect(store.getAgent(created.id)).toBeUndefined();
  });

  it("deleteAgent returns false for missing id", () => {
    expect(store.deleteAgent("nonexistent")).toBe(false);
  });

  it("listAgents returns all agents", () => {
    store.createAgent(testAgent);
    store.createAgent({ ...testAgent, name: "Agent 2", goal: "goal 2" });
    const list = store.listAgents();
    expect(list.length).toBe(2);
  });

  it("listAgents with enabledOnly filters disabled agents", () => {
    store.createAgent(testAgent);
    store.createAgent({ ...testAgent, name: "Disabled Agent", goal: "disabled", enabled: false });
    const list = store.listAgents(true);
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("Reddit Trends");
  });

  it("enableAgent sets enabled to true", () => {
    const created = store.createAgent({ ...testAgent, enabled: false });
    const enabled = store.enableAgent(created.id);
    expect(enabled).toBeDefined();
    expect(enabled!.enabled).toBe(true);
  });

  it("disableAgent sets enabled to false", () => {
    const created = store.createAgent(testAgent);
    const disabled = store.disableAgent(created.id);
    expect(disabled).toBeDefined();
    expect(disabled!.enabled).toBe(false);
  });
});
