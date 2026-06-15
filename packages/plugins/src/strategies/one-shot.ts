import type { ThinkingStrategy, StrategyInput, StrategyOutput, StrategyStep } from "./types.js";

/**
 * One-Shot strategy: single LLM call → direct action.
 * The simplest observe-think-act cycle.
 */
export class OneShotStrategy implements ThinkingStrategy {
  readonly name = "one-shot";
  readonly description = "Single-step prediction: observe → think → act in one cycle";

  async *think(input: StrategyInput): AsyncGenerator<StrategyStep, StrategyOutput, unknown> {
    if (input.signal?.aborted) {
      return {
        steps: [],
        finalAnswer: "",
        reasoning: "Aborted",
        confidence: 0,
      };
    }

    const step: StrategyStep = {
      thought: `Direct approach: ${input.goal}`,
      action: input.availableActions[0]?.name ?? "analyze",
      args: { goal: input.goal },
      expectedOutcome: "Complete the request in one pass",
    };

    yield step;

    return {
      steps: [step],
      finalAnswer: "",
      reasoning: `Direct single-step execution for: ${input.goal}`,
      confidence: 0.8,
    };
  }
}
