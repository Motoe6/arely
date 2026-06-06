import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleWebhook } from "../../src/agents/triggers/webhook.js";

vi.mock("../../src/agents/runtime.js", () => ({
  executeAgent: vi.fn(),
}));

import { executeAgent } from "../../src/agents/runtime.js";

const mockConfig = {
  sessionManager: {} as any,
  llm: {} as any,
};

describe("handleWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should execute the agent and return ok", async () => {
    vi.mocked(executeAgent).mockResolvedValueOnce({ ok: true });

    const result = await handleWebhook("agent-1", { headers: {}, body: {} }, mockConfig);
    expect(result).toEqual({ ok: true });
    expect(executeAgent).toHaveBeenCalledWith("agent-1", mockConfig);
  });

  it("should return error when agent is already running", async () => {
    vi.mocked(executeAgent).mockResolvedValueOnce({ ok: true });

    const first = handleWebhook("agent-1", { headers: {}, body: {} }, mockConfig);
    const second = handleWebhook("agent-1", { headers: {}, body: {} }, mockConfig);

    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: false, error: "Agent agent-1 is already running" });
  });

  it("should allow re-execution after completion", async () => {
    vi.mocked(executeAgent).mockResolvedValue({ ok: true });

    await handleWebhook("agent-1", { headers: {}, body: {} }, mockConfig);
    await handleWebhook("agent-1", { headers: {}, body: {} }, mockConfig);

    expect(executeAgent).toHaveBeenCalledTimes(2);
  });

  it("should return agent errors", async () => {
    vi.mocked(executeAgent).mockResolvedValueOnce({ ok: false, error: "Agent disabled" });

    const result = await handleWebhook("agent-1", { headers: {}, body: {} }, mockConfig);
    expect(result).toEqual({ ok: false, error: "Agent disabled" });
  });

  it("should handle executeAgent throwing", async () => {
    vi.mocked(executeAgent).mockRejectedValueOnce(new Error("Unexpected error"));

    const result = await handleWebhook("agent-1", { headers: {}, body: {} }, mockConfig);
    expect(result).toEqual({ ok: false, error: "Error: Unexpected error" });
  });
});
