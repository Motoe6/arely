import { eq, and, isNull, or, lt, gt } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb } from "./database.js";
import { approvalCache } from "./schema.js";
import type { ApprovalCacheEntry, ApprovalScope } from "./types/data.js";

export function setApproval(data: {
  sessionId?: string;
  toolName: string;
  argsPattern: string;
  scope: ApprovalScope;
  granted: boolean;
}): ApprovalCacheEntry {
  const id = ulid();
  const now = new Date().toISOString();
  const expiresAt =
    data.scope === "once"
      ? new Date(Date.now() + 3600_000).toISOString()
      : data.scope === "forever"
        ? null
        : new Date(Date.now() + 24 * 3600_000).toISOString();

  const row = {
    id,
    sessionId: data.sessionId ?? null,
    toolName: data.toolName,
    argsPattern: data.argsPattern,
    scope: data.scope,
    granted: data.granted ? 1 : 0,
    createdAt: now,
    expiresAt,
  };
  getDb().insert(approvalCache).values(row).run();
  return toDomain(row);
}

export function findMatchingApproval(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): ApprovalCacheEntry | undefined {
  const now = new Date().toISOString();
  const results = getDb()
    .select()
    .from(approvalCache)
    .where(
      and(
        eq(approvalCache.toolName, toolName),
        or(
          eq(approvalCache.sessionId, sessionId),
          isNull(approvalCache.sessionId),
        ),
        or(
          isNull(approvalCache.expiresAt),
          gt(approvalCache.expiresAt, now),
        ),
      ),
    )
    .all();

  for (const row of results) {
    const entry = toDomain(row);
    if (matchPattern(entry.argsPattern, args)) {
      return entry;
    }
  }
  return undefined;
}

export function clearSessionCache(sessionId: string): void {
  getDb()
    .delete(approvalCache)
    .where(eq(approvalCache.sessionId, sessionId))
    .run();
}

export function expireOnceEntries(_toolCallId: string): void {
  getDb()
    .delete(approvalCache)
    .where(
      and(
        eq(approvalCache.scope, "once"),
        lt(
          approvalCache.expiresAt,
          new Date().toISOString(),
        ),
      ),
    )
    .run();
}

function matchPattern(pattern: string, args: Record<string, unknown>): boolean {
  if (pattern === "*") return true;
  const serialized = JSON.stringify(args);
  if (pattern.includes("*")) {
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
    );
    return regex.test(serialized);
  }
  return serialized === pattern;
}

function toDomain(row: Record<string, unknown>): ApprovalCacheEntry {
  return {
    id: row.id as string,
    sessionId: row.sessionId as string | null,
    toolName: row.toolName as string,
    argsPattern: row.argsPattern as string,
    scope: row.scope as ApprovalScope,
    granted: (row.granted as number) === 1,
    createdAt: row.createdAt as string,
    expiresAt: row.expiresAt as string | null,
  };
}
