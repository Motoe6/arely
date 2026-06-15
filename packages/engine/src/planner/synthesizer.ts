import type { LLMAdapter } from "@arely/llm-core";
import type { StepExecutionResult } from "../types.js";

export type SynthesizerResult =
  | { ok: true; response: string }
  | { ok: false; error: string };

const SYSTEM_PROMPT = `You are a synthesis engine. Combine the completed workflow results into a coherent answer. Do not mention planning, workflow execution, or step IDs. Return only the final answer.`;

export class Synthesizer {
  async synthesize(
    goal: string,
    results: StepExecutionResult[],
    llm?: LLMAdapter,
    signal?: AbortSignal,
  ): Promise<SynthesizerResult> {
    if (signal?.aborted) {
      return { ok: false, error: "Synthesis cancelled" };
    }

    const completed = results.filter((r) => r.result && r.result.trim().length > 0);
    if (completed.length === 0) {
      return { ok: false, error: "No completed step results available" };
    }

    if (llm) {
      if (signal?.aborted) {
        return { ok: false, error: "Synthesis cancelled" };
      }

      const resultsBlock = completed.map((r) => `Step: ${r.description}\nResult: ${r.result}`).join("\n\n");
      const userPrompt = `Goal:\n${goal}\n\nResults:\n${resultsBlock}`;

      try {
        let content = "";
        for await (const chunk of llm.complete(
          [
            { role: "system" as const, content: SYSTEM_PROMPT, timestamp: Date.now() },
            { role: "user" as const, content: userPrompt, timestamp: Date.now() },
          ],
          signal,
        )) {
          content += chunk.content;
        }
        const trimmed = content.trim();
        if (trimmed) {
          return { ok: true, response: trimmed };
        }
      } catch {
        // fallback to concatenation
      }
    }

    const response = completed.map((r) => r.result).join("\n\n");
    return { ok: true, response };
  }
}
