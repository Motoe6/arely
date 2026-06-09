import { eq, and, gt } from "drizzle-orm";
import { getDb } from "./database.js";
import { eventLog } from "./schema.js";
import type { EventLogEntry } from "../types.js";
import type { AgentEvent } from "../types/events.js";

export function persistEvent(
  sessionId: string,
  event: AgentEvent,
): number {
  const result = getDb()
    .insert(eventLog)
    .values({
      sessionId,
      eventType: event.type,
      eventData: JSON.stringify(event),
      eventVersion: event.version,
      correlationId: event.correlationId ?? null,
    })
    .run();

  return Number(result.lastInsertRowid);
}

export function persistSystemEvent(event: AgentEvent): number {
  const result = getDb()
    .insert(eventLog)
    .values({
      sessionId: null,
      eventType: event.type,
      eventData: JSON.stringify(event),
      eventVersion: event.version,
      correlationId: event.correlationId ?? null,
    })
    .run();

  return Number(result.lastInsertRowid);
}

export function getEventsAfter(
  sessionId: string,
  lastSequence: number,
  limit = 500,
): EventLogEntry[] {
  const rows = getDb()
    .select()
    .from(eventLog)
    .where(
      and(
        eq(eventLog.sessionId, sessionId),
        gt(eventLog.sequence, lastSequence),
      ),
    )
    .orderBy(eventLog.sequence)
    .limit(limit)
    .all();

  return rows.map(toDomain);
}

export function getSessionEvents(
  sessionId: string,
  limit = 1000,
): EventLogEntry[] {
  const rows = getDb()
    .select()
    .from(eventLog)
    .where(eq(eventLog.sessionId, sessionId))
    .orderBy(eventLog.sequence)
    .limit(limit)
    .all();

  return rows.map(toDomain);
}

export function getLatestSequence(sessionId: string): number {
  const rows = getDb()
    .select()
    .from(eventLog)
    .where(eq(eventLog.sessionId, sessionId))
    .orderBy(eventLog.sequence)
    .limit(1)
    .all();
  return rows.length > 0 ? rows[0].sequence : 0;
}

function toDomain(row: Record<string, unknown>): EventLogEntry {
  return {
    sequence: row.sequence as number,
    sessionId: row.sessionId as string | null,
    eventType: row.eventType as string,
    eventData: JSON.parse(row.eventData as string),
    eventVersion: row.eventVersion as number,
    correlationId: row.correlationId as string | null,
    createdAt: row.createdAt as string,
  };
}
