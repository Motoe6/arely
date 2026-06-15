import { ulid } from "ulid"
import { eq, and, desc, sql } from "drizzle-orm"
import { getDb } from "./database.js"
import { contextEpochs, epochMessages } from "./schema.js"
import type { ContextEpoch, EpochMessage } from "./types/cognition.js"

type DbClient = any

function resolveDb(db?: DbClient): DbClient {
  return db ?? getDb()
}

export function createEpoch(
  data: { sessionId: string; epochNumber: number; baselineContext?: string },
  db?: DbClient,
): ContextEpoch {
  const d = resolveDb(db)
  const id = ulid()
  const now = new Date().toISOString()
  const row = {
    id,
    sessionId: data.sessionId,
    epochNumber: data.epochNumber,
    baselineContext: data.baselineContext ?? "",
    messageCount: 0,
    createdAt: now,
  } as const
  d.insert(contextEpochs).values(row).run()
  return { ...row, messageCount: 0, createdAt: now }
}

export function getEpoch(epochId: string, db?: DbClient): ContextEpoch | null {
  const d = resolveDb(db)
  const row = d.select().from(contextEpochs).where(eq(contextEpochs.id, epochId)).get() as Record<string, unknown> | undefined
  if (!row) return null
  return mapEpochRow(row)
}

export function getEpochsBySession(sessionId: string, db?: DbClient): ContextEpoch[] {
  const d = resolveDb(db)
  const rows = d.select().from(contextEpochs)
    .where(eq(contextEpochs.sessionId, sessionId))
    .orderBy(contextEpochs.epochNumber)
    .all() as Record<string, unknown>[]
  return rows.map(mapEpochRow)
}

export function getCurrentEpoch(sessionId: string, db?: DbClient): ContextEpoch | null {
  const d = resolveDb(db)
  const rows = d.select().from(contextEpochs)
    .where(eq(contextEpochs.sessionId, sessionId))
    .orderBy(desc(contextEpochs.epochNumber))
    .limit(1)
    .all() as Record<string, unknown>[]
  if (rows.length === 0) return null
  return mapEpochRow(rows[0])
}

export function updateEpoch(
  epochId: string,
  updates: { baselineContext?: string; messageCount?: number },
  db?: DbClient,
): ContextEpoch | null {
  const d = resolveDb(db)
  const setValues: Record<string, unknown> = {}
  if (updates.baselineContext !== undefined) setValues.baselineContext = updates.baselineContext
  if (updates.messageCount !== undefined) setValues.messageCount = updates.messageCount
  if (Object.keys(setValues).length === 0) return getEpoch(epochId, db)
  d.update(contextEpochs).set(setValues).where(eq(contextEpochs.id, epochId)).run()
  return getEpoch(epochId, db)
}

export function addEpochMessage(
  data: { sessionId: string; epochId: string; role: string; content: string; sequence: number },
  db?: DbClient,
): EpochMessage {
  const d = resolveDb(db)
  const id = ulid()
  const now = new Date().toISOString()
  const row = {
    id,
    sessionId: data.sessionId,
    epochId: data.epochId,
    role: data.role as "user" | "assistant" | "system",
    content: data.content,
    sequence: data.sequence,
    createdAt: now,
  }
  d.insert(epochMessages).values(row).run()

  // Increment message count on epoch
  d.update(contextEpochs)
    .set({ messageCount: sql`message_count + 1` })
    .where(eq(contextEpochs.id, data.epochId))
    .run()

  return row
}

export function getEpochMessages(epochId: string, db?: DbClient): EpochMessage[] {
  const d = resolveDb(db)
  const rows = d.select().from(epochMessages)
    .where(eq(epochMessages.epochId, epochId))
    .orderBy(epochMessages.sequence)
    .all() as Record<string, unknown>[]
  return rows.map(mapEpochMsgRow)
}

export function getRecentMessages(
  sessionId: string,
  limit = 50,
  db?: DbClient,
): EpochMessage[] {
  const d = resolveDb(db)
  const rows = d.select().from(epochMessages)
    .where(eq(epochMessages.sessionId, sessionId))
    .orderBy(desc(epochMessages.sequence))
    .limit(limit)
    .all() as Record<string, unknown>[]
  return rows.reverse().map(mapEpochMsgRow)
}

export function getEpochMessageCount(sessionId: string, db?: DbClient): number {
  const d = resolveDb(db)
  const result = d.select({ count: epochMessages.id })
    .from(epochMessages)
    .where(eq(epochMessages.sessionId, sessionId))
    .all() as { count: number }[]
  return result.length
}

function mapEpochRow(row: Record<string, unknown>): ContextEpoch {
  return {
    id: row.id as string,
    sessionId: row.sessionId as string,
    epochNumber: row.epochNumber as number,
    baselineContext: (row.baselineContext as string) ?? "",
    messageCount: row.messageCount as number,
    createdAt: row.createdAt as string,
  }
}

function mapEpochMsgRow(row: Record<string, unknown>): EpochMessage {
  return {
    id: row.id as string,
    sessionId: row.sessionId as string,
    epochId: row.epochId as string,
    role: row.role as "user" | "assistant" | "system",
    content: row.content as string,
    sequence: row.sequence as number,
    createdAt: row.createdAt as string,
  }
}
