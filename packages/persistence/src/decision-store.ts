import { eq, and, desc, like, inArray, sql, gte, lte } from "drizzle-orm";
import { getDb } from "./database.js";
import { decisionLog } from "./schema.js";
import type { DecisionRecord, DecisionOutcome, DecisionQuery, MemorySnapshotEntry } from "./types/cognition.js";

function parseJsonField<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function mapRow(row: Record<string, unknown>): DecisionRecord {
  return {
    id: row.id as string,
    sessionId: row.sessionId as string ?? row.session_id as string,
    decisionType: row.decisionType as string ?? row.decision_type as string,
    decision: row.decision as string,
    rationale: row.rationale as string,
    confidence: (row.confidence ?? 100) as number,
    memoriesUsed: parseJsonField<string[]>(row.memoriesUsed as string ?? row.memories_used as string, []),
    memorySnapshot: parseJsonField<MemorySnapshotEntry[]>(row.memorySnapshot as string ?? row.memory_snapshot as string, []),
    epochId: (row.epochId ?? row.epoch_id) as string | null,
    proposalId: (row.proposalId ?? row.proposal_id) as string | null,
    templateId: (row.templateId ?? row.template_id) as string | null,
    outcome: (row.outcome ?? "pending") as DecisionOutcome,
    outcomeDetail: (row.outcomeDetail ?? row.outcome_detail) as string | null,
    metadata: parseJsonField<Record<string, unknown>>(row.metadata as string, {}),
    createdAt: row.createdAt as string ?? row.created_at as string,
  };
}

export function createDecision(data: {
  id: string;
  sessionId: string;
  decisionType: string;
  decision: string;
  rationale: string;
  confidence?: number;
  memoriesUsed?: string[];
  memorySnapshot?: MemorySnapshotEntry[];
  epochId?: string | null;
  proposalId?: string | null;
  templateId?: string | null;
  outcome?: DecisionOutcome;
  outcomeDetail?: string | null;
  metadata?: Record<string, unknown>;
}): DecisionRecord {
  const db = getDb();
  db.insert(decisionLog)
    .values({
      id: data.id,
      sessionId: data.sessionId,
      decisionType: data.decisionType,
      decision: data.decision,
      rationale: data.rationale,
      confidence: data.confidence ?? 100,
      memoriesUsed: JSON.stringify(data.memoriesUsed ?? []),
      memorySnapshot: JSON.stringify(data.memorySnapshot ?? []),
      epochId: data.epochId ?? null,
      proposalId: data.proposalId ?? null,
      templateId: data.templateId ?? null,
      outcome: data.outcome ?? "pending",
      outcomeDetail: data.outcomeDetail ?? null,
      metadata: JSON.stringify(data.metadata ?? {}),
    })
    .run();
  return getDecision(data.id)!;
}

export function getDecision(id: string): DecisionRecord | null {
  const db = getDb();
  const rows = db.select().from(decisionLog).where(eq(decisionLog.id, id)).limit(1).all();
  if (rows.length === 0) return null;
  return mapRow(rows[0] as unknown as Record<string, unknown>);
}

export function queryDecisions(q: DecisionQuery): DecisionRecord[] {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];

  if (q.sessionId) conditions.push(eq(decisionLog.sessionId, q.sessionId));
  if (q.decisionType) conditions.push(eq(decisionLog.decisionType, q.decisionType));
  if (q.proposalId) conditions.push(eq(decisionLog.proposalId, q.proposalId));
  if (q.templateId) conditions.push(eq(decisionLog.templateId, q.templateId));
  if (q.outcome) conditions.push(eq(decisionLog.outcome, q.outcome));

  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;

  let query: any = db.select().from(decisionLog);
  if (conditions.length > 0) query = query.where(and(...conditions));
  const rows = query.orderBy(desc(decisionLog.createdAt)).limit(limit).offset(offset).all();

  return rows.map((r: unknown) => mapRow(r as Record<string, unknown>));
}

export function updateOutcome(id: string, outcome: DecisionOutcome, detail?: string | null): boolean {
  const db = getDb();
  const result = db
    .update(decisionLog)
    .set({ outcome, outcomeDetail: detail ?? null })
    .where(eq(decisionLog.id, id))
    .run();
  return (result.changes ?? 0) > 0;
}

export function countDecisions(q: DecisionQuery): number {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];
  if (q.sessionId) conditions.push(eq(decisionLog.sessionId, q.sessionId));
  if (q.decisionType) conditions.push(eq(decisionLog.decisionType, q.decisionType));
  if (q.proposalId) conditions.push(eq(decisionLog.proposalId, q.proposalId));
  if (q.templateId) conditions.push(eq(decisionLog.templateId, q.templateId));
  if (q.outcome) conditions.push(eq(decisionLog.outcome, q.outcome));

  let query: any = db.select({ count: sql<number>`count(*)` }).from(decisionLog);
  if (conditions.length > 0) query = query.where(and(...conditions));
  const result = query.get();
  return result?.count ?? 0;
}
