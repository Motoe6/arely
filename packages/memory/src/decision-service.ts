import { ulid } from "ulid";
import { createDecision, queryDecisions, getDecision, updateOutcome, getCurrentEpoch, searchMemories } from "@arely/persistence";
import type { DecisionRecord, DecisionOutcome, DecisionQuery } from "./decision-types.js";

export type OutcomeUpdatedCallback = (decisionId: string) => void | Promise<void>;
let onOutcomeUpdated: OutcomeUpdatedCallback | null = null;

export function setOutcomeUpdatedCallback(cb: OutcomeUpdatedCallback): void {
  onOutcomeUpdated = cb;
}

export class DecisionService {
  async logDecision(data: {
    sessionId: string;
    decisionType: string;
    decision: string;
    rationale: string;
    confidence?: number;
    proposalId?: string | null;
    templateId?: string | null;
    outcome?: DecisionOutcome;
    outcomeDetail?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<DecisionRecord> {
    const id = ulid();

    const currentEpoch = getCurrentEpoch(data.sessionId);
    const epochId = currentEpoch?.id ?? null;

    const recentMemories = await searchMemories(data.sessionId, {
      limit: 10,
      minConfidence: 0.3,
    });

    const memoriesUsed = recentMemories.map((m) => m.id);
    const memorySnapshot = recentMemories.map((m) => ({
      id: m.id,
      type: m.type,
      key: m.key,
      value: m.value,
    }));

    return createDecision({
      id,
      sessionId: data.sessionId,
      decisionType: data.decisionType,
      decision: data.decision,
      rationale: data.rationale,
      confidence: data.confidence ?? 100,
      memoriesUsed,
      memorySnapshot,
      epochId,
      proposalId: data.proposalId ?? null,
      templateId: data.templateId ?? null,
      outcome: data.outcome ?? "pending",
      outcomeDetail: data.outcomeDetail ?? null,
      metadata: data.metadata ?? {},
    });
  }

  getDecision(id: string): DecisionRecord | null {
    return getDecision(id);
  }

  queryDecisions(q: DecisionQuery): DecisionRecord[] {
    return queryDecisions(q);
  }

  updateOutcome(id: string, outcome: DecisionOutcome, detail?: string): boolean {
    const ok = updateOutcome(id, outcome, detail);
    if (ok) {
      onOutcomeUpdated?.(id);
    }
    return ok;
  }
}

export const decisionService = new DecisionService();
