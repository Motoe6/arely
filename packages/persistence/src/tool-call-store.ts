import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb } from "./database.js";
import { toolCalls } from "./schema.js";
import type { ToolCallRecord, ToolStatus } from "./types/data.js";

export function createToolCall(data: {
  sessionId: string;
  toolName: string;
  args: unknown;
  permissionMode?: string;
}): ToolCallRecord {
  const id = ulid();
  const now = new Date().toISOString();
  const row: ToolCallRecord = {
    id,
    sessionId: data.sessionId,
    toolName: data.toolName,
    args: data.args,
    status: "pending",
    result: null,
    error: null,
    startTime: null,
    endTime: null,
    durationMs: null,
    provider: null,
    permissionMode: (data.permissionMode ?? "ask") as ToolCallRecord["permissionMode"],
    permissionGranted: null as number | null,
    createdAt: now,
  };
  getDb().insert(toolCalls).values({
    ...row,
    args: JSON.stringify(data.args),
  }).run();
  return row;
}

export function updateToolCallStatus(
  id: string,
  status: ToolStatus,
  extra?: {
    result?: string;
    error?: string;
    provider?: string;
  },
): void {
  const updates: Record<string, unknown> = { status };
  if (extra?.result !== undefined) updates.result = extra.result;
  if (extra?.error !== undefined) updates.error = extra.error;
  if (extra?.provider !== undefined) updates.provider = extra.provider;

  if (status === "running" && !extra?.result) {
    updates.startTime = new Date().toISOString();
  }
  if (["completed", "failed", "cancelled", "timed_out"].includes(status)) {
    updates.endTime = new Date().toISOString();
    const existing = getToolCall(id);
    if (existing?.startTime) {
      updates.durationMs =
        new Date(updates.endTime as string).getTime() -
        new Date(existing.startTime).getTime();
    }
  }

  getDb().update(toolCalls).set(updates).where(eq(toolCalls.id, id)).run();
}

export function getToolCall(id: string): ToolCallRecord | undefined {
  return getDb().select().from(toolCalls).where(eq(toolCalls.id, id)).get() as
    | ToolCallRecord
    | undefined;
}

export function getSessionToolCalls(sessionId: string): ToolCallRecord[] {
  return getDb()
    .select()
    .from(toolCalls)
    .where(eq(toolCalls.sessionId, sessionId))
    .orderBy(toolCalls.createdAt)
    .all() as ToolCallRecord[];
}
