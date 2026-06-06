import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb } from "../persistence/database.js";
import { agents } from "../persistence/schema.js";
import type { AgentRecord, AgentDefinition } from "./types.js";

interface DrizzleAgent {
  id: string; name: string; description: string | null; goal: string;
  mode: string; trigger: string; triggerConfig: string | null;
  enabled: number; createdAt: string; updatedAt: string;
}

function fromRow(row: DrizzleAgent): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    goal: row.goal,
    mode: row.mode as "planning",
    trigger: row.trigger as AgentRecord["trigger"],
    triggerConfig: row.triggerConfig,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createAgent(data: AgentDefinition): AgentRecord {
  const now = new Date().toISOString();
  const id = ulid();
  getDb().insert(agents).values({
    id,
    name: data.name,
    description: data.description ?? null,
    goal: data.goal,
    mode: "planning",
    trigger: data.trigger,
    triggerConfig: data.triggerConfig ?? null,
    enabled: data.enabled ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  }).run();
  return getAgent(id)!;
}

export function getAgent(id: string): AgentRecord | undefined {
  const row = getDb().select().from(agents).where(eq(agents.id, id)).get();
  return row ? fromRow(row) : undefined;
}

export function updateAgent(id: string, data: Partial<AgentDefinition>): AgentRecord | undefined {
  const existing = getAgent(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updatedAt: now };
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.goal !== undefined) updates.goal = data.goal;
  if (data.trigger !== undefined) updates.trigger = data.trigger;
  if (data.triggerConfig !== undefined) updates.triggerConfig = data.triggerConfig;
  if (data.enabled !== undefined) updates.enabled = data.enabled ? 1 : 0;
  getDb().update(agents).set(updates).where(eq(agents.id, id)).run();
  return getAgent(id);
}

export function deleteAgent(id: string): boolean {
  const existing = getAgent(id);
  if (!existing) return false;
  getDb().delete(agents).where(eq(agents.id, id)).run();
  return true;
}

export function listAgents(enabledOnly = false): AgentRecord[] {
  const rows = getDb().select().from(agents).orderBy(agents.createdAt).all() as DrizzleAgent[];
  return (enabledOnly ? rows.filter((r) => r.enabled === 1) : rows).map(fromRow);
}

export function enableAgent(id: string): AgentRecord | undefined {
  const existing = getAgent(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  getDb().update(agents).set({ enabled: 1, updatedAt: now }).where(eq(agents.id, id)).run();
  return getAgent(id);
}

export function disableAgent(id: string): AgentRecord | undefined {
  const existing = getAgent(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  getDb().update(agents).set({ enabled: 0, updatedAt: now }).where(eq(agents.id, id)).run();
  return getAgent(id);
}
