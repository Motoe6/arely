import { MetaReasoner } from "./meta-reasoner.js";
import { StrategyEvaluator } from "./strategy-evaluator.js";

export type Strategy =
  | "exploratory"
  | "confident"
  | "research_first"
  | "template_driven"
  | "cautious";

export interface StrategyRecommendation {
  strategy: Strategy;
  label: string;
  instruction: string;
}

interface StrategyCandidate {
  strategy: Strategy;
  label: string;
  instruction: string;
}

const CANDIDATES: StrategyCandidate[] = [
  {
    strategy: "research_first",
    label: "Research-first approach",
    instruction: "Prioritize web search for factual information gathering before committing to tool calls.",
  },
  {
    strategy: "template_driven",
    label: "Template-driven approach",
    instruction: "Prefer template-driven evolution over structural changes when possible.",
  },
  {
    strategy: "confident",
    label: "Confident approach",
    instruction: "Continue with current approach — past strategies have been consistently effective.",
  },
  {
    strategy: "exploratory",
    label: "Exploratory approach",
    instruction: "Consider multiple strategies and verify outcomes — results have been inconsistent.",
  },
  {
    strategy: "cautious",
    label: "Cautious approach",
    instruction: "Verify outcomes before proceeding — past approaches have had mixed results.",
  },
];

export class StrategySelector {
  constructor(
    private metaReasoner: MetaReasoner = new MetaReasoner(),
    private evaluator: StrategyEvaluator = new StrategyEvaluator(),
  ) {}

  async recommend(sessionId: string): Promise<StrategyRecommendation> {
    const stats = await this.metaReasoner.buildDecisionStats(sessionId);
    const stratPerf = await this.evaluator.getStrategyPerformance(sessionId);

    // No data at all — default to exploratory
    if (stats.length === 0) {
      return {
        strategy: "exploratory",
        label: "No prior data",
        instruction: "No prior session data available — explore multiple approaches.",
      };
    }

    // Compute overall session success rate as fallback for strategies without perf data
    const total = stats.reduce((s, g) => s + g.total, 0);
    const successes = stats.reduce((s, g) => s + g.successes, 0);
    const overallRate = Math.round((successes / total) * 100);

    // Compute expected success rate for each candidate strategy
    const withRates: Array<StrategyCandidate & { expectedRate: number }> = CANDIDATES.map((c) => {
      const perf = stratPerf.find((p) => p.strategy === c.strategy);
      const expectedRate =
        perf && perf.total >= 2
          ? perf.successRate       // observed strategy performance
          : overallRate;           // fallback to overall session rate
      return { ...c, expectedRate };
    });

    // argmax: pick the strategy with highest expected success rate
    withRates.sort((a, b) => b.expectedRate - a.expectedRate);
    const best = withRates[0];

    // Check for weak decision types regardless of selected strategy
    const weak = stats.filter((s) => s.total >= 2 && s.successRate < 60);
    const weakNote =
      weak.length > 0
        ? ` Areas needing caution: ${weak.map((s) => `${s.type} (${s.successRate}%)`).join(", ")}.`
        : "";

    return {
      strategy: best.strategy,
      label: `${best.label} — ${best.expectedRate}% expected success`,
      instruction: `Expected success rate: ${best.expectedRate}% (${successes}/${total} overall).${weakNote} ${best.instruction}`,
    };
  }
}
