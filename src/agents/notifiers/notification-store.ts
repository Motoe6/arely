import { eq, and, lte, or, sql, inArray } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb } from "../../persistence/database.js";
import { notificationQueue, notificationEvents } from "../../persistence/schema.js";
import type { Alert } from "../alert-rules.js";

export type NotificationStatus = "pending" | "retrying" | "sent" | "dead";

export interface NotificationRecord {
  id: string;
  channel: string;
  alertJson: string;
  idempotencyKey: string;
  status: NotificationStatus;
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationEventRecord {
  id: string;
  notificationId: string;
  channel: string;
  status: string;
  error: string | null;
  attemptedAt: string;
}

export interface QueueCounts {
  pending: number;
  retrying: number;
  sent: number;
  dead: number;
}

export interface NotificationStore {
  insert(notification: {
    id: string;
    channel: string;
    alertJson: string;
    idempotencyKey: string;
    maxRetries: number;
  }): void;
  updateStatus(id: string, status: NotificationStatus, lastError?: string | null, retryCount?: number, nextRetryAt?: string | null): void;
  getPendingRetries(now: string): NotificationRecord[];
  getDeadLetters(): NotificationRecord[];
  getById(id: string): NotificationRecord | undefined;
  getCounts(): QueueCounts;
  insertEvent(event: {
    notificationId: string;
    channel: string;
    status: string;
    error?: string | null;
  }): void;
}

export function createNotificationStore(): NotificationStore {
  function insert(notification: {
    id: string;
    channel: string;
    alertJson: string;
    idempotencyKey: string;
    maxRetries: number;
  }): void {
    const db = getDb();
    db.insert(notificationQueue).values({
      id: notification.id,
      channel: notification.channel,
      alertJson: notification.alertJson,
      idempotencyKey: notification.idempotencyKey,
      maxRetries: notification.maxRetries,
      status: "pending",
      retryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
  }

  function updateStatus(id: string, status: NotificationStatus, lastError?: string | null, retryCount?: number, nextRetryAt?: string | null): void {
    const db = getDb();
    const values: Record<string, unknown> = { status, updatedAt: new Date().toISOString() };
    if (lastError !== undefined) values.lastError = lastError;
    if (retryCount !== undefined) values.retryCount = retryCount;
    if (nextRetryAt !== undefined) values.nextRetryAt = nextRetryAt;
    db.update(notificationQueue).set(values).where(eq(notificationQueue.id, id)).run();
  }

  function getPendingRetries(now: string): NotificationRecord[] {
    const db = getDb();
    return db.select().from(notificationQueue)
      .where(
        and(
          inArray(notificationQueue.status, ["pending" as const, "retrying" as const]),
          or(
            lte(notificationQueue.nextRetryAt, now),
            sql`${notificationQueue.nextRetryAt} IS NULL`,
          ),
        ),
      )
      .all() as NotificationRecord[];
  }

  function getDeadLetters(): NotificationRecord[] {
    const db = getDb();
    return db.select().from(notificationQueue)
      .where(eq(notificationQueue.status, "dead"))
      .all() as NotificationRecord[];
  }

  function getById(id: string): NotificationRecord | undefined {
    const db = getDb();
    return db.select().from(notificationQueue)
      .where(eq(notificationQueue.id, id))
      .get() as NotificationRecord | undefined;
  }

  function getCounts(): QueueCounts {
    const db = getDb();
    const rows = db.select({
      status: notificationQueue.status,
      count: sql<number>`COUNT(*)`.as<number>("count"),
    }).from(notificationQueue)
      .groupBy(notificationQueue.status)
      .all() as { status: string; count: number }[];
    const counts: QueueCounts = { pending: 0, retrying: 0, sent: 0, dead: 0 };
    for (const row of rows) {
      if (row.status === "pending") counts.pending = row.count;
      else if (row.status === "retrying") counts.retrying = row.count;
      else if (row.status === "sent") counts.sent = row.count;
      else if (row.status === "dead") counts.dead = row.count;
    }
    return counts;
  }

  function insertEvent(event: {
    notificationId: string;
    channel: string;
    status: string;
    error?: string | null;
  }): void {
    const db = getDb();
    db.insert(notificationEvents).values({
      id: ulid(),
      notificationId: event.notificationId,
      channel: event.channel,
      status: event.status,
      error: event.error ?? null,
      attemptedAt: new Date().toISOString(),
    }).run();
  }

  return { insert, updateStatus, getPendingRetries, getDeadLetters, getById, getCounts, insertEvent };
}
