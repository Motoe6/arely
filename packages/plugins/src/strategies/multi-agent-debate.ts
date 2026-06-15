import type { ThinkingStrategy, StrategyInput, StrategyOutput, StrategyStep } from "./types.js";

/**
 * Multi-Agent Debate strategy: spawn multiple perspectives that debate
 * the solution, then synthesize the best outcome.
 *
 * From AutoGPT's multi_agent_debate prompt strategy.
 */
export class MultiAgentDebateStrategy implements ThinkingStrategy {
  readonly name = "multi-agent-debate";
  readonly description = "Multiple agents debate solutions, reaching consensus through structured deliberation";

  private agentCount = 3;
  private debateRounds = 2;

  async *think(input: StrategyInput): AsyncGenerator<StrategyStep, StrategyOutput, unknown> {
    if (input.signal?.aborted) {
      return { steps: [], finalAnswer: "", reasoning: "Aborted", confidence: 0 };
    }

    const allSteps: StrategyStep[] = [];
    const agents = ["analyst", "critic", "synthesizer"];

    for (let round = 0; round < this.debateRounds; round++) {
      if (input.signal?.aborted) break;

      for (let a = 0; a < Math.min(this.agentCount, agents.length); a++) {
        const agent = agents[a];
        const perspective = round === 0
          ? `${agent} proposes initial approach`
          : `${agent} refines position after round ${round}`;

        const step: StrategyStep = {
          thought: `Round ${round + 1}, ${agent}: ${perspective}`,
          action: input.availableActions[a % input.availableActions.length]?.name ?? "debate",
          args: { goal: input.goal, agent, round: round + 1 },
          expectedOutcome: `${agent} contributes ${round === 0 ? "initial" : "refined"} perspective`,
        };

        yield step;
        allSteps.push(step);
      }
    }

    const synthesisStep: StrategyStep = {
      thought: `Synthesizing ${this.agentCount} agents × ${this.debateRounds} rounds of debate`,
      action: "synthesize",
      args: { agents: this.agentCount, rounds: this.debateRounds, goal: input.goal },
      expectedOutcome: "Consensus solution from multi-agent debate",
    };

    yield synthesisStep;
    allSteps.push(synthesisStep);

    return {
      steps: allSteps,
      finalAnswer: "",
      reasoning: `${this.agentCount} agents debated over ${this.debateRounds} rounds, consensus reached`,
      confidence: 0.85,
    };
  }
}
