import { eq, inArray, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb } from "./database.js";
import { policyAuditEvents } from "./schema.js";

export interface PolicyAuditEvent {
  id: string;
  traceId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TraceSummary {
  traceId: string;
  createdAt: string;
  eventCount: number;
}

export function insertEvent(traceId: string, eventType: string, payload: unknown, createdAt?: string): void {
  getDb()
    .insert(policyAuditEvents)
    .values({
      id: ulid(),
      traceId,
      eventType,
      payload: JSON.stringify(payload),
      createdAt: createdAt ?? new Date().toISOString(),
    })
    .run();
}

export function getTrace(traceId: string): PolicyAuditEvent[] {
  const rows = getDb()
    .select()
    .from(policyAuditEvents)
    .where(eq(policyAuditEvents.traceId, traceId))
    .orderBy(policyAuditEvents.createdAt)
    .all();

  return rows.map(toDomain);
}

export function listTraces(limit = 20, offset = 0): TraceSummary[] {
  const rows = getDb()
    .select({
      traceId: policyAuditEvents.traceId,
      minCreatedAt: sql<string>`MIN(${policyAuditEvents.createdAt})`,
      eventCount: sql<number>`COUNT(*)`,
    })
    .from(policyAuditEvents)
    .groupBy(policyAuditEvents.traceId)
    .orderBy(sql`MIN(${policyAuditEvents.createdAt}) DESC`)
    .limit(limit)
    .offset(offset)
    .all();

  return rows.map((r) => ({
    traceId: r.traceId,
    createdAt: r.minCreatedAt,
    eventCount: r.eventCount,
  }));
}

export function countTraces(): number {
  const row = getDb()
    .select({
      count: sql<number>`COUNT(DISTINCT ${policyAuditEvents.traceId})`,
    })
    .from(policyAuditEvents)
    .all();

  return row[0]?.count ?? 0;
}

export function prune(retentionDays: number): number {
  const cutoff = new Date(
    Date.now() - retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const rows = getDb()
    .select({
      traceId: policyAuditEvents.traceId,
    })
    .from(policyAuditEvents)
    .groupBy(policyAuditEvents.traceId)
    .having(sql`MIN(${policyAuditEvents.createdAt}) < ${cutoff}`)
    .all();

  if (rows.length === 0) return 0;

  const traceIds = rows.map((r) => r.traceId);
  const CHUNK = 500;

  for (let i = 0; i < traceIds.length; i += CHUNK) {
    const chunk = traceIds.slice(i, i + CHUNK);
    getDb()
      .delete(policyAuditEvents)
      .where(inArray(policyAuditEvents.traceId, chunk))
      .run();
  }

  return traceIds.length;
}

function toDomain(row: { id: string; traceId: string; eventType: string; payload: string; createdAt: string }): PolicyAuditEvent {
  return {
    id: row.id,
    traceId: row.traceId,
    eventType: row.eventType,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}
