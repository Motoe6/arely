import type { ThinkingStrategy, StrategyInput, StrategyOutput, StrategyStep } from "./types.js";

/**
 * Reflexion strategy: execute, reflect on the result, learn from mistakes,
 * then retry with improved approach. Cycles through:
 * 1. Propose action
 * 2. Execute
 * 3. Reflect on outcome
 * 4. Refine approach
 *
 * From AutoGPT's reflexion prompt strategy.
 */
export class ReflexionStrategy implements ThinkingStrategy {
  readonly name = "reflexion";
  readonly description = "Reflect on past attempts, learn from mistakes, refine and retry";

  private maxReflections = 3;

  async *think(input: StrategyInput): AsyncGenerator<StrategyStep, StrategyOutput, unknown> {
    if (input.signal?.aborted) {
      return { steps: [], finalAnswer: "", reasoning: "Aborted", confidence: 0 };
    }

    const reflections = input.history.filter((h) => h.outcome.toLowerCase().includes("error") || h.outcome.toLowerCase().includes("fail"));

    const allSteps: StrategyStep[] = [];
    const attempts = Math.min(this.maxReflections, reflections.length + 1);

    for (let i = 0; i < attempts; i++) {
      if (input.signal?.aborted) break;

      const lesson = reflections[i]
        ? `Previous attempt failed: ${reflections[i].outcome}. Adjusting approach.`
        : "First attempt, proceeding directly.";

      const step: StrategyStep = {
        thought: `Attempt ${i + 1}/${attempts}. ${lesson}`,
        action: input.availableActions[0]?.name ?? "analyze",
        args: { goal: input.goal, attempt: i + 1, lesson },
        expectedOutcome: `Complete with learned improvements (attempt ${i + 1})`,
      };

      yield step;
      allSteps.push(step);
    }

    return {
      steps: allSteps,
      finalAnswer: "",
      reasoning: `Reflexion: ${allSteps.length} attempts with iterative refinement`,
      confidence: 0.6 + (allSteps.length > 1 ? 0.2 : 0),
    };
  }
}
