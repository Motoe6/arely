import { getDb } from "./database.js";
import { globalMemory, memoryEntities, entityRelations } from "./schema.js";
import { eq, and, sql, desc, gte, or, isNull, type SQL } from "drizzle-orm";
import { ulid } from "ulid";
import type {
  GlobalMemoryRecord,
  GlobalMemorySearchQuery,
  MemoryEntityRecord,
  EntityRelationRecord,
} from "./types/global-memory.js";

function mapGlobalRow(row: Record<string, unknown>): GlobalMemoryRecord {
  return {
    id: row.id as string,
    content: row.content as string,
    sessionIds: JSON.parse((row.sessionIds ?? row.session_ids ?? "[]") as string),
    entities: JSON.parse((row.entities ?? "[]") as string),
    tags: JSON.parse((row.tags ?? "[]") as string),
    importance: Number(row.importance ?? 1.0),
    confidence: Number(row.confidence ?? 100),
    accessCount: Number(row.accessCount ?? row.access_count ?? 0),
    lastAccessedAt: (row.lastAccessedAt ?? row.last_accessed_at) as string | null,
    embedding: row.embedding ? JSON.parse(row.embedding as string) : null,
    archivedAt: (row.archivedAt ?? row.archived_at) as string | null,
    createdAt: (row.createdAt ?? row.created_at) as string,
    updatedAt: (row.updatedAt ?? row.updated_at) as string,
  };
}

export async function setGlobalMemory(
  content: string,
  sessionId: string,
  entities: string[] = [],
  tags: string[] = [],
  importance: number = 1.0,
  confidence: number = 100,
): Promise<GlobalMemoryRecord> {
  const db = getDb();
  const id = ulid();

  await db
    .insert(globalMemory)
    .values({
      id,
      content,
      sessionIds: JSON.stringify([sessionId]),
      entities: JSON.stringify(entities),
      tags: JSON.stringify(tags),
      importance,
      confidence,
    })
    .run();

  for (const entity of entities) {
    await db
      .insert(memoryEntities)
      .values({
        id: ulid(),
        memoryId: id,
        entity,
        type: "concept",
      })
      .run();
  }

  return (await getGlobalMemory(id))!;
}

export async function getGlobalMemory(id: string): Promise<GlobalMemoryRecord | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(globalMemory)
    .where(eq(globalMemory.id, id))
    .limit(1)
    .all();
  if (rows.length === 0) return null;
  const rec = mapGlobalRow(rows[0] as unknown as Record<string, unknown>);
  touchGlobalAccess(rec.id);
  return rec;
}

export async function searchGlobalMemories(
  q: GlobalMemorySearchQuery,
): Promise<GlobalMemoryRecord[]> {
  const db = getDb();
  const conditions: SQL[] = [];

  if (q.minImportance !== undefined) {
    conditions.push(gte(globalMemory.importance, q.minImportance));
  }
  if (q.minConfidence !== undefined) {
    conditions.push(gte(globalMemory.confidence, q.minConfidence));
  }

  const limit = q.limit ?? 100;
  const offset = q.offset ?? 0;

  let query: any = db.select().from(globalMemory);

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const rows = await query
    .orderBy(desc(globalMemory.importance), desc(globalMemory.confidence), desc(globalMemory.updatedAt))
    .limit(limit)
    .offset(offset)
    .all();

  let results: GlobalMemoryRecord[] = rows.map((r: unknown) => mapGlobalRow(r as Record<string, unknown>));

  if (q.query) {
    const lower = q.query.toLowerCase();
    results = results.filter((r) => r.content.toLowerCase().includes(lower));
  }

  if (q.tags && q.tags.length > 0) {
    results = results.filter((r) => q.tags!.some((t) => r.tags.includes(t)));
  }

  if (q.entities && q.entities.length > 0) {
    results = results.filter((r) => q.entities!.some((e) => r.entities.includes(e)));
  }

  return results;
}

export async function getMemoryEntities(memoryId: string): Promise<MemoryEntityRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memoryEntities)
    .where(eq(memoryEntities.memoryId, memoryId))
    .all();
  return rows as unknown as MemoryEntityRecord[];
}

export async function getEntityMemories(entity: string): Promise<GlobalMemoryRecord[]> {
  const db = getDb();
  const rows = await db
    .select({ gm: globalMemory })
    .from(globalMemory)
    .innerJoin(memoryEntities, eq(memoryEntities.memoryId, globalMemory.id))
    .where(eq(memoryEntities.entity, entity))
    .all();
  return rows.map((r: unknown) => mapGlobalRow((r as { gm: Record<string, unknown> }).gm));
}

export async function upsertEntityRelation(
  sourceEntity: string,
  targetEntity: string,
  relationType: string = "related",
  weight: number = 1.0,
): Promise<EntityRelationRecord> {
  const db = getDb();
  const existing = await db
    .select()
    .from(entityRelations)
    .where(
      and(
        eq(entityRelations.sourceEntity, sourceEntity),
        eq(entityRelations.targetEntity, targetEntity),
        eq(entityRelations.relationType, relationType),
      ),
    )
    .limit(1)
    .all();

  if (existing.length > 0) {
    await db
      .update(entityRelations)
      .set({
        weight: sql`weight + ${weight}`,
        updatedAt: sql`datetime('now')`,
      })
      .where(eq(entityRelations.id, (existing[0] as unknown as EntityRelationRecord).id))
      .run();
    const updated = await db
      .select()
      .from(entityRelations)
      .where(eq(entityRelations.id, (existing[0] as unknown as EntityRelationRecord).id))
      .limit(1)
      .all();
    return updated[0] as unknown as EntityRelationRecord;
  }

  const id = ulid();
  await db
    .insert(entityRelations)
    .values({
      id,
      sourceEntity,
      targetEntity,
      weight,
      relationType,
    })
    .run();
  const created = await db
    .select()
    .from(entityRelations)
    .where(eq(entityRelations.id, id))
    .limit(1)
    .all();
  return created[0] as unknown as EntityRelationRecord;
}

export async function getEntityRelations(entity: string): Promise<EntityRelationRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(entityRelations)
    .where(
      or(
        eq(entityRelations.sourceEntity, entity),
        eq(entityRelations.targetEntity, entity),
      ),
    )
    .orderBy(desc(entityRelations.weight))
    .all();
  return rows as unknown as EntityRelationRecord[];
}

export async function deleteGlobalMemory(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(globalMemory)
    .where(eq(globalMemory.id, id))
    .run();
  return (result.changes ?? 0) > 0;
}

export async function countGlobalMemories(): Promise<number> {
  const db = getDb();
  const row = await db
    .select({ count: sql<number>`count(*)` })
    .from(globalMemory)
    .get();
  return row?.count ?? 0;
}

export async function countDistinctEntities(): Promise<number> {
  const db = getDb();
  const row = await db
    .select({ count: sql<number>`count(distinct ${memoryEntities.entity})` })
    .from(memoryEntities)
    .get();
  return row?.count ?? 0;
}

export async function countEntityRelations(): Promise<number> {
  const db = getDb();
  const row = await db
    .select({ count: sql<number>`count(*)` })
    .from(entityRelations)
    .get();
  return row?.count ?? 0;
}

export async function getRelatedEntities(
  entity: string,
): Promise<Array<{ entity: string; weight: number; relationType: string }>> {
  const rels = await getEntityRelations(entity);
  const related = new Map<string, { weight: number; relationType: string }>();

  for (const rel of rels) {
    const connected = rel.sourceEntity === entity ? rel.targetEntity : rel.sourceEntity;
    const existing = related.get(connected);
    if (existing) {
      existing.weight += rel.weight;
    } else {
      related.set(connected, { weight: rel.weight, relationType: rel.relationType });
    }
  }

  return Array.from(related.entries())
    .map(([e, data]) => ({ entity: e, ...data }))
    .sort((a, b) => b.weight - a.weight);
}

async function touchGlobalAccess(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(globalMemory)
    .set({
      accessCount: sql`access_count + 1`,
      lastAccessedAt: sql`datetime('now')`,
    })
    .where(eq(globalMemory.id, id))
    .run();
}

// ─── B2.3.3–B2.3.5: Prioritization, Forgetting, Consolidation ───

export async function updateGlobalMemory(
  id: string,
  updates: Partial<{
    content: string;
    sessionIds: string[];
    entities: string[];
    tags: string[];
    importance: number;
    confidence: number;
    archivedAt: string | null;
  }>,
): Promise<GlobalMemoryRecord | null> {
  const db = getDb();
  const setValues: Record<string, unknown> = { updatedAt: sql`datetime('now')` };

  if (updates.content !== undefined) setValues.content = updates.content;
  if (updates.sessionIds !== undefined) setValues.sessionIds = JSON.stringify(updates.sessionIds);
  if (updates.entities !== undefined) setValues.entities = JSON.stringify(updates.entities);
  if (updates.tags !== undefined) setValues.tags = JSON.stringify(updates.tags);
  if (updates.importance !== undefined) setValues.importance = updates.importance;
  if (updates.confidence !== undefined) setValues.confidence = updates.confidence;
  if (updates.archivedAt !== undefined) setValues.archivedAt = updates.archivedAt;

  await db
    .update(globalMemory)
    .set(setValues)
    .where(eq(globalMemory.id, id))
    .run();

  return getGlobalMemory(id);
}

export async function listAllGlobalMemories(
  opts: { includeArchived?: boolean; limit?: number; offset?: number } = {},
): Promise<GlobalMemoryRecord[]> {
  const db = getDb();
  let query: any = db.select().from(globalMemory);

  if (!opts.includeArchived) {
    query = query.where(isNull(globalMemory.archivedAt));
  }

  const rows = await query
    .orderBy(desc(globalMemory.importance), desc(globalMemory.confidence))
    .limit(opts.limit ?? 1000)
    .offset(opts.offset ?? 0)
    .all();

  return rows.map((r: unknown) => mapGlobalRow(r as Record<string, unknown>));
}

export async function countArchivedMemories(): Promise<number> {
  const db = getDb();
  const row = await db
    .select({ count: sql<number>`count(*)` })
    .from(globalMemory)
    .where(sql`archived_at IS NOT NULL`)
    .get();
  return row?.count ?? 0;
}

export async function deleteGlobalMemories(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = getDb();
  let deleted = 0;
  for (const id of ids) {
    const result = await db.delete(globalMemory).where(eq(globalMemory.id, id)).run();
    if ((result.changes ?? 0) > 0) deleted++;
  }
  return deleted;
}
