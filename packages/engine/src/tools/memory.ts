import { eq, and } from "drizzle-orm";
import { getDb } from "../persistence/database.js";
import { agentMemory } from "../persistence/schema.js";

export interface MemoryRecord {
  agentId: string;
  key: string;
  value: string;
  updatedAt: string;
}

export function agentMemoryGet(agentId: string, key: string): string | undefined {
  const row = getDb()
    .select()
    .from(agentMemory)
    .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)))
    .get();
  return row?.value;
}

export function agentMemorySet(agentId: string, key: string, value: string): void {
  const now = new Date().toISOString();
  getDb()
    .insert(agentMemory)
    .values({ agentId, key, value, updatedAt: now })
    .onConflictDoUpdate({
      target: [agentMemory.agentId, agentMemory.key],
      set: { value, updatedAt: now },
    })
    .run();
}

export function agentMemoryList(agentId: string): MemoryRecord[] {
  return getDb()
    .select()
    .from(agentMemory)
    .where(eq(agentMemory.agentId, agentId))
    .orderBy(agentMemory.updatedAt)
    .all();
}

export function agentMemoryDelete(agentId: string, key: string): boolean {
  const result = getDb()
    .delete(agentMemory)
    .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)))
    .run();
  return result.changes > 0;
}

export function agentMemoryClear(agentId: string): void {
  getDb()
    .delete(agentMemory)
    .where(eq(agentMemory.agentId, agentId))
    .run();
}
