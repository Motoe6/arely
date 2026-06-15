import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb } from "./database.js";
import { sessions } from "./schema.js";
import type { Session } from "./types/data.js";

export function createSession(data: {
  id?: string;
  query: string;
  model: string;
  toolMode: "native" | "text";
}): Session {
  const id = data.id ?? ulid();
  const now = new Date().toISOString();
  const row = {
    id,
    state: "idle" as const,
    query: data.query,
    model: data.model,
    toolMode: data.toolMode,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    error: null,
  };
  getDb().insert(sessions).values(row).run();
  return row;
}

export function getSession(id: string): Session | undefined {
  return getDb().select().from(sessions).where(eq(sessions.id, id)).get() as Session | undefined;
}

export function updateSessionState(
  id: string,
  state: Session["state"],
  error?: string,
): void {
  getDb()
    .update(sessions)
    .set({
      state,
      error: error ?? null,
      updatedAt: new Date().toISOString(),
      completedAt: state === "completed" || state === "error" ? new Date().toISOString() : undefined,
    })
    .where(eq(sessions.id, id))
    .run();
}

export function listSessions(limit = 20, offset = 0): Session[] {
  return getDb()
    .select()
    .from(sessions)
    .orderBy(sessions.createdAt)
    .limit(limit)
    .offset(offset)
    .all() as Session[];
}
