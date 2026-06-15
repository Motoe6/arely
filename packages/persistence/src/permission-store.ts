import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb } from "./database.js";
import { permissionApprovals } from "./schema.js";
import type { PermissionApproval } from "./types/data.js";

export function createPermissionApproval(data: {
  sessionId: string;
  toolName: string;
  args: unknown;
  mode: string;
  granted: boolean;
  responseTimeMs: number | null;
}): PermissionApproval {
  const id = ulid();
  const row = {
    id,
    sessionId: data.sessionId,
    toolName: data.toolName,
    args: JSON.stringify(data.args),
    mode: data.mode,
    granted: data.granted ? 1 : 0,
    respondedAt: new Date().toISOString(),
    responseTimeMs: data.responseTimeMs,
  };
  getDb().insert(permissionApprovals).values(row).run();
  return toDomain(row);
}

export function getSessionApprovals(sessionId: string): PermissionApproval[] {
  return getDb()
    .select()
    .from(permissionApprovals)
    .where(eq(permissionApprovals.sessionId, sessionId))
    .all()
    .map(toDomain);
}

function toDomain(
  row: Record<string, unknown>,
): PermissionApproval {
  return {
    id: row.id as string,
    sessionId: row.sessionId as string,
    toolName: row.toolName as string,
    args: JSON.parse(row.args as string),
    mode: row.mode as PermissionApproval["mode"],
    granted: (row.granted as number) === 1,
    respondedAt: row.respondedAt as string,
    responseTimeMs: row.responseTimeMs as number | null,
  };
}
