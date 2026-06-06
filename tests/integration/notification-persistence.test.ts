import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { connect, getDb } from "../../src/persistence/database.js";
import { notificationQueue, notificationEvents } from "../../src/persistence/schema.js";
import { eq } from "drizzle-orm";
import { createNotificationStore } from "../../src/agents/notifiers/notification-store.js";
import { ReliableNotificationService } from "../../src/agents/notifiers/notification-service.js";
import type { AlertNotifier } from "../../src/agents/notifiers/notifier-types.js";
import type { Alert } from "../../src/agents/alert-rules.js";

const sampleAlert: Alert = {
  ruleId: "test_rule",
  severity: "warning",
  category: "success_rate",
  message: "Test alert",
  metric: 0.5,
  threshold: 0.8,
  target: "test_tool",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("Notification Persistence Integration", () => {
  beforeAll(() => {
    connect(":memory:");
    const db = getDb();
    const sqlite = (db as any).session?.client;
    sqlite?.exec("DELETE FROM notification_events");
    sqlite?.exec("DELETE FROM notification_queue");
  });

  beforeEach(() => {
    const db = getDb();
    const sqlite = (db as any).session?.client;
    sqlite?.exec("DELETE FROM notification_events");
    sqlite?.exec("DELETE FROM notification_queue");
  });

  it("writes and reads notification queue records", () => {
    const store = createNotificationStore();
    store.insert({
      id: "test_notif_1",
      channel: "slack",
      alertJson: JSON.stringify(sampleAlert),
      idempotencyKey: "key1",
      maxRetries: 3,
    });

    const db = getDb();
    const rows = db.select().from(notificationQueue).where(eq(notificationQueue.id, "test_notif_1")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("slack");
    expect(rows[0].status).toBe("pending");
    expect(rows[0].maxRetries).toBe(3);
    expect(rows[0].retryCount).toBe(0);
  });

  it("writes and reads notification event records", () => {
    const store = createNotificationStore();
    store.insert({
      id: "test_notif_2",
      channel: "discord",
      alertJson: JSON.stringify(sampleAlert),
      idempotencyKey: "key2",
      maxRetries: 3,
    });

    store.insertEvent({
      notificationId: "test_notif_2",
      channel: "discord",
      status: "sent",
    });

    const db = getDb();
    const rows = db.select().from(notificationEvents)
      .where(eq(notificationEvents.notificationId, "test_notif_2"))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("discord");
    expect(rows[0].status).toBe("sent");
    expect(rows[0].error).toBeNull();
  });

  it("transitions through statuses correctly", () => {
    const store = createNotificationStore();
    store.insert({
      id: "test_notif_3",
      channel: "slack",
      alertJson: JSON.stringify(sampleAlert),
      idempotencyKey: "key3",
      maxRetries: 3,
    });

    let record = store.getById("test_notif_3");
    expect(record?.status).toBe("pending");

    store.updateStatus("test_notif_3", "retrying", "Connection failed", 1, new Date(Date.now() + 5000).toISOString());
    record = store.getById("test_notif_3");
    expect(record?.status).toBe("retrying");
    expect(record?.lastError).toBe("Connection failed");
    expect(record?.retryCount).toBe(1);
    expect(record?.nextRetryAt).toBeTruthy();

    store.updateStatus("test_notif_3", "sent");
    record = store.getById("test_notif_3");
    expect(record?.status).toBe("sent");
    expect(record?.lastError).toBe("Connection failed");
  });

  it("full lifecycle: queueAlert eager fail + processQueue retry + sent", async () => {
    let attempts = 0;
    const notifier: AlertNotifier = {
      send: vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 2) throw new Error("Temporary failure");
      }),
    };

    const service = new ReliableNotificationService(notifier, {
      maxRetries: 3,
      retryBaseDelayMs: 0,
      idempotencyWindowS: 300,
    });

    const queueResult = await service.queueAlert(sampleAlert, "slack");
    expect(queueResult.ok).toBe(false);

    const db = getDb();
    let row = db.select().from(notificationQueue).where(eq(notificationQueue.id, queueResult.notificationId)).all();
    expect(row[0].status).toBe("retrying");

    await service.processQueue();

    row = db.select().from(notificationQueue).where(eq(notificationQueue.id, queueResult.notificationId)).all();
    expect(row[0].status).toBe("sent");

    const events = db.select().from(notificationEvents)
      .where(eq(notificationEvents.notificationId, queueResult.notificationId))
      .all();
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});
