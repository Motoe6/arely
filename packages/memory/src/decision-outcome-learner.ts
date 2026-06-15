import type { LLMAdapter } from "@arelyos/llm-core";
import type { DecisionRecord, DecisionOutcome } from "./decision-types.js";
import type { MemoryType, MemorySource } from "./memory-types.js";
import type { SessionMessage } from "@arelyos/llm-core";
import { getDecision, queryDecisions } from "@arelyos/persistence";
import { memoryService } from "./memory-service.js";

export interface OutcomeLearning {
  type: MemoryType;
  key: string;
  value: string;
  confidence: number;
  tags: string[];
}

const OUTCOME_LEARNING_PROMPT = `Analyze this decision and its outcome. Generate 1-2 structured learnings that the system should remember for future behavior.

For each learning, return a JSON array with objects containing:
- "type": one of "user_preference", "project_fact", "architecture_decision", "workflow_pattern", "conversation_summary"
- "key": a short snake_case identifier
- "value": a concise description of what was learned
- "confidence": number 0-100
- "tags": relevant string array

Focus on:
1. What worked or didn't work about this decision
2. Patterns that should be repeated or avoided
3. Generalizable insights, not just facts about this single event

Return ONLY valid JSON, no other text.`;

async function callLLM(
  llm: LLMAdapter,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  signal?: AbortSignal,
): Promise<string> {
  const chatMessages: SessionMessage[] = [
    { role: "system", content: systemPrompt, timestamp: Date.now() },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
      timestamp: Date.now(),
    })),
  ];

  let fullContent = "";
  const generator = llm.complete(chatMessages, signal);
  for await (const response of generator) {
    fullContent += response.content;
  }
  return fullContent.trim();
}

export class DecisionOutcomeLearner {
  constructor(private llm: LLMAdapter, private signal?: AbortSignal) {}

  async learnFromOutcome(decisionId: string): Promise<void> {
    const decision = getDecision(decisionId);
    if (!decision) return;

    if (decision.outcome === "pending") return;

    const learnings = await this.generateLearnings(decision);

    for (const l of learnings) {
      await memoryService.setMemory(
        decision.sessionId,
        l.type,
        l.key,
        l.value,
        l.confidence,
        "derived" as MemorySource,
        [...new Set([...l.tags, "auto-learned", `outcome:${decision.outcome}`])],
      );
    }

    await this.correlateWithPastDecisions(decision);
  }

  async learnFromSessionOutcomes(sessionId: string): Promise<void> {
    const decisions = queryDecisions({ sessionId, outcome: "success" });
    const failed = queryDecisions({ sessionId, outcome: "failure" });
    const all = [...decisions, ...failed];

    for (const d of all) {
      await this.learnFromOutcome(d.id);
    }
  }

  private async generateLearnings(decision: DecisionRecord): Promise<OutcomeLearning[]> {
    const contextLines = [
      `Decision: ${decision.decision}`,
      `Type: ${decision.decisionType}`,
      `Rationale: ${decision.rationale}`,
      `Outcome: ${decision.outcome}`,
      decision.outcomeDetail ? `Detail: ${decision.outcomeDetail}` : "",
      `Memories used: ${decision.memoriesUsed.length}`,
    ].filter(Boolean).join("\n");

    const raw = await callLLM(this.llm, OUTCOME_LEARNING_PROMPT, [
      { role: "user", content: contextLines },
    ], this.signal);

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((m: Record<string, unknown>) =>
          m.type && m.key && m.value && typeof m.type === "string" && typeof m.key === "string" && typeof m.value === "string",
        )
        .map((m: Record<string, unknown>) => ({
          type: m.type as MemoryType,
          key: m.key as string,
          value: m.value as string,
          confidence: typeof m.confidence === "number" ? Math.max(0, Math.min(100, m.confidence)) : 100,
          tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === "string") : [],
        }));
    } catch {
      return [];
    }
  }

  private async correlateWithPastDecisions(decision: DecisionRecord): Promise<void> {
    const pastSimilar = queryDecisions({
      sessionId: decision.sessionId,
      decisionType: decision.decisionType,
      limit: 20,
    }).filter((d) => d.id !== decision.id && d.outcome !== "pending");

    if (pastSimilar.length < 2) return;

    const successes = pastSimilar.filter((d) => d.outcome === "success").length;
    const failures = pastSimilar.filter((d) => d.outcome === "failure").length;
    const total = pastSimilar.length;
    const successRate = Math.round((successes / total) * 100);

    if (successRate >= 80) {
      await memoryService.setMemory(
        decision.sessionId,
        "workflow_pattern",
        `${decision.decisionType}_high_success_rate`,
        `${decision.decisionType} decisions have ${successRate}% success rate across ${total} decisions`,
        Math.min(95, successRate),
        "derived",
        ["auto-learned", "correlated", `outcome:${decision.outcome}`],
      );
    }

    if (failures >= 2 && failures >= successes) {
      await memoryService.setMemory(
        decision.sessionId,
        "project_fact",
        `${decision.decisionType}_needs_review`,
        `${decision.decisionType} decisions have high failure rate (${successes}/${total} successes) — consider alternative approaches`,
        Math.min(90, failures * 30),
        "derived",
        ["auto-learned", "correlated", "needs-attention"],
      );
    }
  }
}
