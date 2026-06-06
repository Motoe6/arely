import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb } from "./database.js";
import { messages } from "./schema.js";
import type { Message } from "../types.js";

export function createMessage(data: {
  sessionId: string;
  role: Message["role"];
  content: string;
  sequence: number;
}): Message {
  const id = ulid();
  const row = {
    id,
    sessionId: data.sessionId,
    role: data.role,
    content: data.content,
    sequence: data.sequence,
    createdAt: new Date().toISOString(),
  };
  getDb().insert(messages).values(row).run();
  return row;
}

export function getSessionMessages(sessionId: string): Message[] {
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.sequence)
    .all() as Message[];
}

export function getMessageCount(sessionId: string): number {
  const result = getDb()
    .select({ count: messages.id })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .all();
  return result.length;
}
