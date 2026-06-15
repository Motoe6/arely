import type { ThinkingStrategy, StrategyInput, StrategyOutput, StrategyStep } from "./types.js";

/**
 * ReWOO (Reasoning WithOut Observation) strategy:
 * Decompose the goal into a plan first, then execute step-by-step.
 * Each step declares variable dependencies for parallel execution.
 * From AutoGPT's rewoo prompt strategy.
 */
export class ReWOOStrategy implements ThinkingStrategy {
  readonly name = "rewoo";
  readonly description = "Plan first (decompose into steps with variable deps), then execute step-by-step";

  async *think(input: StrategyInput): AsyncGenerator<StrategyStep, StrategyOutput, unknown> {
    if (input.signal?.aborted) {
      return { steps: [], finalAnswer: "", reasoning: "Aborted", confidence: 0 };
    }

    const planSteps: StrategyStep[] = input.availableActions.map((action, i) => ({
      thought: `Step ${i + 1}: ${action.description}`,
      action: action.name,
      args: { goal: input.goal, step: i + 1 },
      expectedOutcome: `Completed step ${i + 1}`,
    }));

    if (planSteps.length === 0) {
      planSteps.push({
        thought: `Analyze: ${input.goal}`,
        action: "analyze",
        args: { goal: input.goal },
        expectedOutcome: "Understanding of the request",
      });
    }

    for (const step of planSteps) {
      yield step;
    }

    return {
      steps: planSteps,
      finalAnswer: "",
      reasoning: `Decomposed into ${planSteps.length} steps with sequential execution`,
      confidence: 0.7,
    };
  }
}
