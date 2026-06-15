export const TASK_TYPES = [
  "coding",
  "debugging",
  "planning",
  "research",
  "search",
  "translation",
  "conversation",
  "tool_use",
  "agentic",
  "cheap",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export interface TaskProfile {
  type: TaskType;
  complexity: number;
  estimatedTokens: number;
  needsTools: boolean;
}

const PATTERNS: Record<TaskType, RegExp[]> = {
  coding: [
    /\b(implement|write|create|build|develop|program|code|function|class|module|refactor|extract)\b/i,
    /\b(typescript|javascript|python|rust|golang|java|\.ts|\.js|\.py)\b/i,
    /\b(add.*feature|new.*endpoint|write.*test|create.*api)\b/i,
  ],
  debugging: [
    /\b(bug|fix|error|issue|broken|not working|fail|crash|exception)\b/i,
    /\b(debug|trace|log|stack.?trace|wrong|incorrect)\b/i,
    /\b(unexpected|problem|doesn't work|failing)\b/i,
  ],
  planning: [
    /\b(plan|design|architect|proposal|roadmap|strategy|milestone)\b/i,
    /\b(think|decide|approach|option|trade.?off|compare)\b/i,
    /\b(how should|what should|should we|consider)\b/i,
  ],
  research: [
    /\b(research|investigate|explore|find out|learn about|documentation)\b/i,
    /\b(what is|how does|explain|tell me about|understand)\b/i,
    /\b(latest|new|trend|compare.*vs|difference.*between)\b/i,
  ],
  search: [
    /\b(search|find|look.?up|query|discover|locate)\b/i,
    /\b(where is|show me|list|get|retrieve)\b/i,
  ],
  translation: [
    /\b(translate|translation|convert.*(to|from)|in (spanish|french|german|japanese|chinese))\b/i,
    /\b(language|idiom|traducir|traducción)\b/i,
  ],
  conversation: [
    /^(hi|hello|hey|good morning|good afternoon|how are you|thanks|thank you)$/i,
    /\b(greet|welcome|nice to meet|pleasure)\b/i,
  ],
  tool_use: [
    /\b(run|execute|command|shell|terminal|invoke|call.*tool|use.*tool)\b/i,
    /\b(deploy|publish|release|upload|download|install|configure)\b/i,
    /\b(ls|cd |mkdir|rm |git |npm |docker|curl|wget)\b/,
  ],
  agentic: [
    /\b(multi.?step|autonomous|automatic.*(task|process|workflow))\b/i,
    /\b(agent|orchestrat|coordinate|delegate|hand.?off)\b/i,
    /\b(loop|iterate|monitor|watch|continuously)\b/i,
  ],
  cheap: [
    /\b(summarize|concise|brief|short|quick|simple|trivial|easy)\b/i,
    /\b(simple.*(question|answer|reply)|yes|no|ok|okay|sure)\b/i,
  ],
};

export class TaskClassifier {
  classify(text: string): TaskProfile {
    const lower = text.slice(0, 2000);
    const matched = new Map<TaskType, number>();

    for (const [type, patterns] of Object.entries(PATTERNS)) {
      let count = 0;
      for (const re of patterns) {
        const matches = lower.match(re);
        if (matches) count += matches.length;
      }
      if (count > 0) matched.set(type as TaskType, count);
    }

    let primaryType: TaskType = "conversation";
    let maxScore = 0;

    for (const [type, score] of matched) {
      if (score > maxScore) {
        maxScore = score;
        primaryType = type;
      }
    }

    const rawComplexity = (maxScore / 5) * 100;
    const complexity = Math.min(100, Math.round(rawComplexity));

    const estimatedTokens = this.estimateTokens(primaryType, complexity, lower);
    const needsTools = primaryType === "tool_use" || primaryType === "agentic" || primaryType === "coding";

    return { type: primaryType, complexity, estimatedTokens, needsTools };
  }

  private estimateTokens(type: TaskType, complexity: number, _text: string): number {
    const base = _text.length * 0.4;
    const complexityMultiplier = 1 + (complexity / 100) * 2;
    const typeMultiplier: Record<TaskType, number> = {
      coding: 2.0,
      debugging: 1.8,
      planning: 1.5,
      research: 1.6,
      search: 1.0,
      translation: 1.3,
      conversation: 0.8,
      tool_use: 1.4,
      agentic: 2.5,
      cheap: 0.5,
    };
    return Math.round(base * complexityMultiplier * typeMultiplier[type]);
  }
}

export const taskClassifier = new TaskClassifier();
