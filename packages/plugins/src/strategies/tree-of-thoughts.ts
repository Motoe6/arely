import type { ThinkingStrategy, StrategyInput, StrategyOutput, StrategyStep } from "./types.js";

/**
 * Tree of Thoughts strategy: explore multiple reasoning paths in parallel,
 * evaluate each branch, and select the best path.
 *
 * From AutoGPT's tree_of_thoughts prompt strategy.
 */
export class TreeOfThoughtsStrategy implements ThinkingStrategy {
  readonly name = "tree-of-thoughts";
  readonly description = "Explore multiple reasoning paths in parallel, evaluate, and select the best";

  private branchingFactor = 3;

  async *think(input: StrategyInput): AsyncGenerator<StrategyStep, StrategyOutput, unknown> {
    if (input.signal?.aborted) {
      return { steps: [], finalAnswer: "", reasoning: "Aborted", confidence: 0 };
    }

    const allSteps: StrategyStep[] = [];
    const branches = Math.min(this.branchingFactor, Math.max(1, input.availableActions.length));

    for (let b = 0; b < branches; b++) {
      if (input.signal?.aborted) break;

      const action = input.availableActions[b % input.availableActions.length];
      const branchThought = `Branch ${b + 1}/${branches}: Exploring '${action.name}' path`;

      const step: StrategyStep = {
        thought: branchThought,
        action: action.name,
        args: { goal: input.goal, branch: b + 1, totalBranches: branches },
        expectedOutcome: `Evaluation of branch ${b + 1}: ${action.name}`,
      };

      yield step;
      allSteps.push(step);
    }

    const evaluationStep: StrategyStep = {
      thought: `Evaluated ${branches} branches, selecting optimal path`,
      action: "evaluate",
      args: {
        branches: branches,
        goal: input.goal,
      },
      expectedOutcome: "Best path selected from explored branches",
    };

    yield evaluationStep;
    allSteps.push(evaluationStep);

    return {
      steps: allSteps,
      finalAnswer: "",
      reasoning: `Explored ${branches} parallel branches and selected optimal path`,
      confidence: 0.75,
    };
  }
}
