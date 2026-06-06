import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb } from "./database.js";
import { auditLog } from "./schema.js";
import type { AuditLogEntry } from "../types.js";

export function createAuditLog(data: {
  sessionId?: string;
  category: AuditLogEntry["category"];
  action: string;
  actor: AuditLogEntry["actor"];
  target?: string;
  detail: unknown;
}): AuditLogEntry {
  const id = ulid();
  const row = {
    id,
    sessionId: data.sessionId ?? null,
    category: data.category,
    action: data.action,
    actor: data.actor,
    target: data.target ?? null,
    detail: JSON.stringify(data.detail),
    createdAt: new Date().toISOString(),
  };
  getDb().insert(auditLog).values(row).run();
  return toDomain(row);
}

export function getSessionAuditLogs(sessionId: string): AuditLogEntry[] {
  return getDb()
    .select()
    .from(auditLog)
    .where(eq(auditLog.sessionId, sessionId))
    .orderBy(auditLog.createdAt)
    .all()
    .map(toDomain);
}

export function getAuditLogsByCategory(category: string): AuditLogEntry[] {
  return getDb()
    .select()
    .from(auditLog)
    .where(eq(auditLog.category, category))
    .orderBy(auditLog.createdAt)
    .all()
    .map(toDomain);
}

function toDomain(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: row.id as string,
    sessionId: row.sessionId as string | null,
    category: row.category as AuditLogEntry["category"],
    action: row.action as string,
    actor: row.actor as AuditLogEntry["actor"],
    target: row.target as string | null,
    detail: JSON.parse(row.detail as string),
    createdAt: row.createdAt as string,
  };
}
