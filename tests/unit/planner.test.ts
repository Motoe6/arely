import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMAdapter } from "@arely/engine/llm/adapter.js";
import type { Tool } from "@arely/engine/tools/base-tool.js";

vi.mock("@arely/engine/config/index.js", () => ({
  getConfig: () => ({ PLAN_MAX_STEPS: 10, PLANNING_ENABLED: true }),
}));

import { createPlan } from "@arely/engine/planner/planner.js";

const mockTools = new Map<string, Tool>([
  ["websearch", { name: "websearch", description: "Search", async execute() { return { content: "" }; } }],
  ["webfetch", { name: "webfetch", description: "Fetch", async execute() { return { content: "" }; } }],
]);

function makeLLM(responses: string[]): LLMAdapter {
  let callCount = 0;
  return {
    async *complete() {
      const content = responses[callCount] ?? "";
      callCount++;
      yield { content };
    },
  };
}

function makeLLMGenerator(responses: (string | string[])[]): LLMAdapter {
  let callIndex = 0;
  return {
    async *complete() {
      const r = responses[callIndex] ?? "";
      callIndex++;
      if (Array.isArray(r)) {
        for (const chunk of r) {
          yield { content: chunk };
        }
      } else {
        yield { content: r };
      }
    },
  };
}

describe("createPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("produces a plan from valid LLM JSON response", async () => {
    const llm = makeLLM([JSON.stringify({
      title: "Test plan",
      steps: [
        { description: "Search topic", tool: "websearch", args: { query: "test" }, dependsOn: [] },
        { description: "Analyze", dependsOn: [0] },
      ],
    })]);

    const result = await createPlan("test goal", llm, mockTools, { sessionId: "s1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.goal).toBe("test goal");
      expect(result.plan.sessionId).toBe("s1");
      expect(result.plan.status).toBe("pending");
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].id).toBe("step_0");
      expect(result.steps[1].dependsOn).toBe('["step_0"]');
    }
  });

  it("retries on invalid JSON then succeeds", async () => {
    const llm = makeLLM([
      "not valid json",
      JSON.stringify({
        steps: [
          { description: "Search", tool: "websearch", args: { query: "test" }, dependsOn: [] },
        ],
      }),
    ]);

    const result = await createPlan("test goal", llm, mockTools, { sessionId: "s1" });

    expect(result.ok).toBe(true);
  });

  it("returns error when all retries exhausted", async () => {
    const llm = makeLLM(["invalid", "also invalid"]);

    const result = await createPlan("test goal", llm, mockTools, { sessionId: "s1" });

    expect(result.ok).toBe(false);
  });

  it("returns error on empty LLM response", async () => {
    const llm = makeLLM([""]);

    const result = await createPlan("test goal", llm, mockTools, { sessionId: "s1" });

    expect(result.ok).toBe(false);
  });

  it("retries on unknown tool then succeeds on second attempt", async () => {
    const llm = makeLLM([
      JSON.stringify({
        steps: [
          { description: "Bad tool", tool: "nonexistent", dependsOn: [] },
        ],
      }),
      JSON.stringify({
        steps: [
          { description: "Good tool", tool: "websearch", args: { query: "fixed" }, dependsOn: [] },
        ],
      }),
    ]);

    const result = await createPlan("test goal", llm, mockTools, { sessionId: "s1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.steps[0].tool).toBe("websearch");
    }
  });
});
