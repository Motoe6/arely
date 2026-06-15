import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { connect, getDb } from "@arelyos/engine/persistence/database.js";
import { notificationQueue, notificationEvents } from "@arelyos/engine/persistence/schema.js";
import { getNotificationMetrics } from "@arelyos/engine/agents/notifiers/notification-metrics.js";

function insertQueue(db: ReturnType<typeof getDb>, overrides: Partial<typeof notificationQueue.$inferInsert> & { id: string }) {
  db.insert(notificationQueue).values({
    channel: "slack",
    alertJson: JSON.stringify({ ruleId: "test" }),
    idempotencyKey: "ik_" + overrides.id,
    status: "sent",
    retryCount: 0,
    maxRetries: 3,
    lastError: null,
    nextRetryAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }).run();
}

let eventCounter = 0;

function insertEvent(db: ReturnType<typeof getDb>, overrides: Partial<typeof notificationEvents.$inferInsert> & { notificationId: string; status: string }) {
  eventCounter++;
  db.insert(notificationEvents).values({
    id: "evt_" + overrides.notificationId + "_" + eventCounter,
    channel: "slack",
    error: null,
    attemptedAt: new Date().toISOString(),
    ...overrides,
  }).run();
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

function msAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function nowPlus(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

describe("Notification Metrics", () => {
  beforeAll(() => {
    connect(":memory:");
  });

  beforeEach(() => {
    eventCounter = 0;
    const db = getDb();
    const sqlite = (db as any).session?.client;
    sqlite?.exec("DELETE FROM notification_events");
    sqlite?.exec("DELETE FROM notification_queue");
  });

  it("computes deliveryTimes from real ISO diffs", () => {
    const db = getDb();

    insertQueue(db, { id: "n1", createdAt: "2026-01-01T00:00:00.000Z" });
    insertEvent(db, { notificationId: "n1", status: "sent", attemptedAt: "2026-01-01T00:00:00.500Z" });

    insertQueue(db, { id: "n2", createdAt: "2026-01-01T00:00:01.000Z" });
    insertEvent(db, { notificationId: "n2", status: "sent", attemptedAt: "2026-01-01T00:00:01.200Z" });

    const m = getNotificationMetrics("2025-12-31T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
    expect(m.deliveryTimes.sampleCount).toBe(2);
    expect(m.deliveryTimes.minMs).toBe(200);
    expect(m.deliveryTimes.maxMs).toBe(500);
    expect(m.deliveryTimes.avgMs).toBe(350);
  });

  it("p95 isolates a single slow outlier among fast notifications", () => {
    const db = getDb();
    const baseTime = Date.now() - 100000;

    for (let i = 0; i < 19; i++) {
      const id = `fast_${i}`;
      const created = new Date(baseTime + i * 100).toISOString();
      insertQueue(db, { id, createdAt: created });
      insertEvent(db, { notificationId: id, status: "sent", attemptedAt: new Date(baseTime + i * 100 + 10).toISOString() });
    }

    insertQueue(db, { id: "slow", createdAt: new Date(baseTime + 1900).toISOString() });
    insertEvent(db, { notificationId: "slow", status: "sent", attemptedAt: new Date(baseTime + 1900 + 5000).toISOString() });

    const m = getNotificationMetrics();
    expect(m.deliveryTimes.sampleCount).toBe(20);
    expect(m.deliveryTimes.p50Ms).toBeLessThanOrEqual(500);
    expect(m.deliveryTimes.p95Ms).toBeGreaterThanOrEqual(4000);
    expect(m.deliveryTimes.p99Ms).toBeGreaterThanOrEqual(m.deliveryTimes.p95Ms);
  });

  it("counts firstTrySuccess vs retriedSuccess based on events", () => {
    const db = getDb();

    insertQueue(db, { id: "n1" });
    insertEvent(db, { notificationId: "n1", status: "sent" });

    insertQueue(db, { id: "n2" });
    insertEvent(db, { notificationId: "n2", status: "retrying", error: "fail" });
    insertEvent(db, { notificationId: "n2", status: "sent" });

    insertQueue(db, { id: "n3" });
    insertEvent(db, { notificationId: "n3", status: "retrying", error: "fail" });
    insertEvent(db, { notificationId: "n3", status: "retrying", error: "fail2" });
    insertEvent(db, { notificationId: "n3", status: "sent" });

    const m = getNotificationMetrics();
    expect(m.retryPressure.totalSent).toBe(3);
    expect(m.retryPressure.firstTrySuccess).toBe(1);
    expect(m.retryPressure.retriedSuccess).toBe(2);
  });

  it("retryRate is 0 when all sent first-try", () => {
    const db = getDb();

    for (let i = 0; i < 5; i++) {
      const id = `ft_${i}`;
      insertQueue(db, { id });
      insertEvent(db, { notificationId: id, status: "sent" });
    }

    const m = getNotificationMetrics();
    expect(m.retryPressure.retryRate).toBe(0);
    expect(m.retryPressure.firstTrySuccess).toBe(5);
    expect(m.retryPressure.retriedSuccess).toBe(0);
  });

  it("deadLetterRate is 0.5 when equal sent and dead", () => {
    const db = getDb();

    insertQueue(db, { id: "d1", status: "sent" });
    insertEvent(db, { notificationId: "d1", status: "sent" });
    insertQueue(db, { id: "d2", status: "dead" });

    const m = getNotificationMetrics();
    expect(m.deadLetterRate.totalTerminal).toBe(2);
    expect(m.deadLetterRate.sentCount).toBe(1);
    expect(m.deadLetterRate.deadCount).toBe(1);
    expect(m.deadLetterRate.deadLetterRate).toBe(0.5);
  });

  it("queueLag returns zero counts for empty queue", () => {
    const m = getNotificationMetrics();
    expect(m.queueLag.pendingCount).toBe(0);
    expect(m.queueLag.retryingCount).toBe(0);
    expect(m.queueLag.maxLagMs).toBe(0);
    expect(m.queueLag.avgLagMs).toBe(0);
    expect(m.queueLag.p95LagMs).toBe(0);
  });

  it("queueLag reflects pending and retrying items", () => {
    const db = getDb();

    insertQueue(db, { id: "p1", status: "pending", createdAt: msAgo(10000) });
    insertQueue(db, { id: "p2", status: "pending", createdAt: msAgo(5000) });
    insertQueue(db, { id: "r1", status: "retrying", createdAt: msAgo(20000) });

    const m = getNotificationMetrics();
    expect(m.queueLag.pendingCount).toBe(2);
    expect(m.queueLag.retryingCount).toBe(1);
    expect(m.queueLag.maxLagMs).toBeGreaterThanOrEqual(19000);
    expect(m.queueLag.avgLagMs).toBeGreaterThan(0);
  });

  it("channelBreakdown groups correctly", () => {
    const db = getDb();

    insertQueue(db, { id: "s1", channel: "slack", status: "sent" });
    insertEvent(db, { notificationId: "s1", channel: "slack", status: "sent" });
    insertQueue(db, { id: "s2", channel: "slack", status: "sent" });
    insertEvent(db, { notificationId: "s2", channel: "slack", status: "sent" });
    insertQueue(db, { id: "d1", channel: "discord", status: "dead" });
    insertQueue(db, { id: "e1", channel: "email", status: "pending" });

    const m = getNotificationMetrics();
    expect(m.channelBreakdown).toHaveLength(3);
    const slack = m.channelBreakdown.find((c) => c.channel === "slack")!;
    expect(slack.total).toBe(2);
    expect(slack.sent).toBe(2);
    const discord = m.channelBreakdown.find((c) => c.channel === "discord")!;
    expect(discord.total).toBe(1);
    expect(discord.dead).toBe(1);
    const email = m.channelBreakdown.find((c) => c.channel === "email")!;
    expect(email.total).toBe(1);
    expect(email.pending).toBe(1);
  });

  it("defaults timeWindow to last 24h", () => {
    const db = getDb();

    insertQueue(db, { id: "old", createdAt: daysAgo(2), status: "pending" });

    const m = getNotificationMetrics();
    const windowStart = new Date(m.timeWindow.windowStart).getTime();
    const windowEnd = new Date(m.timeWindow.windowEnd).getTime();
    expect(windowEnd - windowStart).toBeGreaterThanOrEqual(86000000);
    expect(m.queueLag.pendingCount).toBe(0);
  });

  it("custom timeWindow filters correctly", () => {
    const db = getDb();

    insertQueue(db, { id: "inside", createdAt: "2026-01-01T12:00:00.000Z", status: "pending" });
    insertQueue(db, { id: "outside", createdAt: "2026-01-02T12:00:00.000Z", status: "pending" });

    const m = getNotificationMetrics("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
    expect(m.queueLag.pendingCount).toBe(1);
  });

  it("empty store returns zeroed metrics (no NaN)", () => {
    const m = getNotificationMetrics("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");

    expect(m.deliveryTimes.p50Ms).toBe(0);
    expect(m.deliveryTimes.p95Ms).toBe(0);
    expect(m.deliveryTimes.avgMs).toBe(0);
    expect(m.deliveryTimes.sampleCount).toBe(0);

    expect(m.retryPressure.totalSent).toBe(0);
    expect(m.retryPressure.retryRate).toBe(0);

    expect(m.deadLetterRate.deadLetterRate).toBe(0);

    expect(m.queueLag.maxLagMs).toBe(0);

    expect(m.channelBreakdown).toHaveLength(0);
  });

  it("ensures monotonicity: p50 <= p95 <= p99", () => {
    const db = getDb();

    for (let i = 0; i < 100; i++) {
      const id = `mono_${i}`;
      const created = new Date(2026, 0, 1, 0, 0, 0, i).toISOString();
      insertQueue(db, { id, createdAt: created });
      insertEvent(db, { notificationId: id, status: "sent", attemptedAt: new Date(2026, 0, 1, 0, 0, 0, i + Math.floor(Math.random() * 100)).toISOString() });
    }

    const m = getNotificationMetrics("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
    expect(m.deliveryTimes.p50Ms).toBeLessThanOrEqual(m.deliveryTimes.p95Ms);
    expect(m.deliveryTimes.p95Ms).toBeLessThanOrEqual(m.deliveryTimes.p99Ms);
  });

  it("avgRetriesPerNotification reflects retryCount from queue rows", () => {
    const db = getDb();

    insertQueue(db, { id: "r1", retryCount: 0 });
    insertEvent(db, { notificationId: "r1", status: "sent" });

    insertQueue(db, { id: "r2", retryCount: 2 });
    insertEvent(db, { notificationId: "r2", status: "retrying", error: "e1" });
    insertEvent(db, { notificationId: "r2", status: "sent" });

    insertQueue(db, { id: "r3", retryCount: 3 });
    insertEvent(db, { notificationId: "r3", status: "retrying", error: "e1" });
    insertEvent(db, { notificationId: "r3", status: "retrying", error: "e2" });
    insertEvent(db, { notificationId: "r3", status: "sent" });

    const m = getNotificationMetrics();
    expect(m.retryPressure.avgRetriesPerNotification).toBeCloseTo(1.67, 1);
    expect(m.retryPressure.retriedSuccess).toBe(2);
    expect(m.retryPressure.firstTrySuccess).toBe(1);
  });
});
