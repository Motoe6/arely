import { describe, it, expect, vi } from "vitest";
import { Synthesizer } from "@opencode/engine/planner/synthesizer.js";
import type { LLMAdapter } from "@opencode/engine/llm/adapter.js";
import type { StepExecutionResult } from "@opencode/engine/types.js";

function makeLLM(...responses: string[]): LLMAdapter {
  let i = 0;
  return {
    async *complete() {
      yield { content: responses[i++] ?? "" };
    },
  };
}

const completed: StepExecutionResult[] = [
  { stepId: "step_0", description: "Search web", result: "Found result A", durationMs: 100 },
  { stepId: "step_1", description: "Fetch page", result: "Fetched content B", durationMs: 200 },
];

const mixed: StepExecutionResult[] = [
  { stepId: "step_0", description: "Search", result: "Good result", durationMs: 50 },
  { stepId: "step_1", description: "Failed fetch", result: null, error: "timeout", durationMs: 5000 },
  { stepId: "step_2", description: "Empty result", result: "", durationMs: 10 },
  { stepId: "step_3", description: "Whitespace", result: "   ", durationMs: 5 },
];

describe("Synthesizer", () => {
  it("synthesizes via LLM when available", async () => {
    const synth = new Synthesizer();
    const llm = makeLLM("Final synthesized answer");

    const result = await synth.synthesize("test goal", completed, llm);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toBe("Final synthesized answer");
    }
  });

  it("falls back to concatenation when no LLM", async () => {
    const synth = new Synthesizer();

    const result = await synth.synthesize("test goal", completed);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toBe("Found result A\n\nFetched content B");
    }
  });

  it("falls back to concatenation when LLM throws", async () => {
    const synth = new Synthesizer();
    const brokenLLM: LLMAdapter = {
      async *complete() {
        throw new Error("LLM unavailable");
      },
    };

    const result = await synth.synthesize("test goal", completed, brokenLLM);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toBe("Found result A\n\nFetched content B");
    }
  });

  it("filters out failed and empty results from mixed input", async () => {
    const synth = new Synthesizer();

    const result = await synth.synthesize("test goal", mixed);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toBe("Good result");
    }
  });

  it("returns error when no completed results available", async () => {
    const synth = new Synthesizer();
    const allEmpty: StepExecutionResult[] = [
      { stepId: "s0", description: "Fail", result: null, error: "err", durationMs: 10 },
      { stepId: "s1", description: "Empty", result: "", durationMs: 5 },
    ];

    const result = await synth.synthesize("test", allEmpty);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No completed step results");
    }
  });

  it("handles abort signal", async () => {
    const synth = new Synthesizer();
    const signal = AbortSignal.abort();

    const result = await synth.synthesize("test goal", completed, undefined, signal);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Synthesis cancelled");
    }
  });
});
