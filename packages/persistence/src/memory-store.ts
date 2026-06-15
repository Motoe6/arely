import { getDb } from "./database.js";
import { memoryStore } from "./schema.js";
import { eq, and, sql, inArray, lt, lte, desc, or, gte } from "drizzle-orm";
import type { MemoryRecord, MemoryType, MemorySearchQuery, MemorySource } from "./types/cognition.js";

function mapRow(row: Record<string, unknown>): MemoryRecord {
  return {
    id: row.id as string,
    sessionId: (row.sessionId ?? row.session_id) as string | null,
    type: row.type as MemoryType,
    key: row.key as string,
    value: row.value as string,
    confidence: (row.confidence ?? 100) as number,
    source: (row.source ?? "explicit") as MemorySource,
    tags: JSON.parse((row.tags ?? "[]") as string) as string[],
    epochId: (row.epochId ?? row.epoch_id) as string | null,
    createdAt: row.createdAt as string ?? row.created_at as string,
    updatedAt: row.updatedAt as string ?? row.updated_at as string,
    accessCount: (row.accessCount ?? row.access_count ?? 0) as number,
    lastAccessedAt: (row.lastAccessedAt ?? row.last_accessed_at) as string | null,
    ttlSeconds: (row.ttlSeconds ?? row.ttl_seconds) as number | null,
  };
}

export async function setMemory(
  id: string,
  sessionId: string | null,
  type: MemoryType,
  key: string,
  value: string,
  confidence: number = 100,
  source: MemorySource = "explicit",
  tags: string[] = [],
  epochId: string | null = null,
  ttlSeconds: number | null = null,
): Promise<MemoryRecord> {
  const db = getDb();
  const existing = await db
    .select()
    .from(memoryStore)
    .where(and(eq(memoryStore.type, type), eq(memoryStore.key, key)))
    .limit(1)
    .all();

  if (existing.length > 0) {
    await db
      .update(memoryStore)
      .set({
        value,
        confidence,
        source,
        tags: JSON.stringify(tags),
        epochId,
        updatedAt: sql`datetime('now')`,
        ttlSeconds,
      })
      .where(and(eq(memoryStore.type, type), eq(memoryStore.key, key)))
      .run();
    return (await getMemory(type, key))!;
  }

  await db
    .insert(memoryStore)
    .values({
      id,
      sessionId,
      type,
      key,
      value,
      confidence,
      source,
      tags: JSON.stringify(tags),
      epochId,
      ttlSeconds,
    })
    .run();
  return (await getMemory(type, key))!;
}

export async function getMemory(type: MemoryType, key: string): Promise<MemoryRecord | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memoryStore)
    .where(and(eq(memoryStore.type, type), eq(memoryStore.key, key)))
    .limit(1)
    .all();
  if (rows.length === 0) return null;
  const rec = mapRow(rows[0] as unknown as Record<string, unknown>);
  touchAccess(rec.id);
  return rec;
}

export async function searchMemories(
  sessionId: string | null,
  query: MemorySearchQuery,
): Promise<MemoryRecord[]> {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];

  if (sessionId) {
    conditions.push(eq(memoryStore.sessionId, sessionId));
  }

  if (query.type) {
    conditions.push(eq(memoryStore.type, query.type));
  } else if (query.typeIn && query.typeIn.length > 0) {
    conditions.push(inArray(memoryStore.type, query.typeIn));
  }

  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;

  let baseQuery = db.select().from(memoryStore);

  if (conditions.length > 0) {
    baseQuery = baseQuery.where(and(...conditions));
  }

  const rows = await baseQuery
    .orderBy(desc(memoryStore.confidence), desc(memoryStore.updatedAt))
    .limit(limit)
    .offset(offset)
    .all();

  let results = rows.map((r: unknown) => mapRow(r as Record<string, unknown>));

  if (query.minConfidence) {
    results = results.filter((r) => r.confidence >= query.minConfidence!);
  }

  if (query.tags && query.tags.length > 0) {
    results = results.filter((r) => query.tags!.some((t) => r.tags.includes(t)));
  }

  return results;
}

export async function listBySession(sessionId: string): Promise<MemoryRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memoryStore)
    .where(eq(memoryStore.sessionId, sessionId))
    .orderBy(desc(memoryStore.updatedAt))
    .all();
  return rows.map((r: unknown) => mapRow(r as Record<string, unknown>));
}

export async function deleteMemory(type: MemoryType, key: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(memoryStore)
    .where(and(eq(memoryStore.type, type), eq(memoryStore.key, key)))
    .run();
  return (result.changes ?? 0) > 0;
}

export async function evictExpired(): Promise<number> {
  const db = getDb();
  const result = await db
    .delete(memoryStore)
    .where(
      and(
        sql`ttl_seconds IS NOT NULL`,
        sql`datetime(last_accessed_at, '+' || ttl_seconds || ' seconds') < datetime('now')`,
      ),
    )
    .run();
  return result.changes ?? 0;
}

export async function evictByCount(maxMemories: number = 5000): Promise<number> {
  const db = getDb();
  const count = await db.select({ count: sql<number>`count(*)` }).from(memoryStore).get();
  const total = count?.count ?? 0;
  if (total <= maxMemories) return 0;

  const excess = total - maxMemories;
  const toRemove = await db
    .select({ id: memoryStore.id })
    .from(memoryStore)
    .orderBy(desc(memoryStore.confidence), desc(memoryStore.lastAccessedAt))
    .limit(excess)
    .all();

  for (const row of toRemove) {
    await db.delete(memoryStore).where(eq(memoryStore.id, row.id)).run();
  }
  return toRemove.length;
}

async function touchAccess(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(memoryStore)
    .set({
      accessCount: sql`access_count + 1`,
      lastAccessedAt: sql`datetime('now')`,
    })
    .where(eq(memoryStore.id, id))
    .run();
}
