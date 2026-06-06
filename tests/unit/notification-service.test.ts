import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReliableNotificationService, type NotificationServiceConfig } from "@opencode/engine/agents/notifiers/notification-service.js";
import type { AlertNotifier } from "@opencode/engine/agents/notifiers/notifier-types.js";
import type { NotificationStore, NotificationRecord } from "@opencode/engine/agents/notifiers/notification-store.js";
import type { Alert } from "@opencode/engine/agents/alert-rules.js";

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

const defaultConfig: NotificationServiceConfig = {
  maxRetries: 3,
  retryBaseDelayMs: 1000,
  idempotencyWindowS: 300,
};

function createMockStore(): NotificationStore {
  const records: NotificationRecord[] = [];
  const events: Array<{ notificationId: string; status: string }> = [];

  return {
    insert(n) {
      records.push({
        id: n.id,
        channel: n.channel,
        alertJson: n.alertJson,
        idempotencyKey: n.idempotencyKey,
        status: "pending",
        retryCount: 0,
        maxRetries: n.maxRetries,
        lastError: null,
        nextRetryAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    },
    updateStatus(id, status, lastError, retryCount, nextRetryAt) {
      const r = records.find((x) => x.id === id);
      if (r) {
        r.status = status;
        if (lastError !== undefined) r.lastError = lastError ?? null;
        if (retryCount !== undefined) r.retryCount = retryCount;
        if (nextRetryAt !== undefined) r.nextRetryAt = nextRetryAt ?? null;
      }
    },
    getPendingRetries(_now: string) {
      return records.filter(
        (r) =>
          (r.status === "pending" || r.status === "retrying") &&
          (!r.nextRetryAt || r.nextRetryAt <= _now),
      );
    },
    getDeadLetters() {
      return records.filter((r) => r.status === "dead");
    },
    getById(id) {
      return records.find((r) => r.id === id);
    },
    getCounts() {
      return {
        pending: records.filter((r) => r.status === "pending").length,
        retrying: records.filter((r) => r.status === "retrying").length,
        sent: records.filter((r) => r.status === "sent").length,
        dead: records.filter((r) => r.status === "dead").length,
      };
    },
    insertEvent(e) {
      events.push({ notificationId: e.notificationId, status: e.status });
    },
  };
}

describe("ReliableNotificationService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("queueAlert", () => {
    it("marks as sent when eager send succeeds", async () => {
      const notifier: AlertNotifier = { send: vi.fn().mockResolvedValue(undefined) };
      const store = createMockStore();
      const service = new ReliableNotificationService(notifier, defaultConfig, store);
      const result = await service.queueAlert(sampleAlert, "slack");
      expect(result.ok).toBe(true);
      expect(result.notificationId).toBeTruthy();
      expect(store.getCounts().sent).toBe(1);
    });

    it("marks as retrying when eager send fails", async () => {
      const notifier: AlertNotifier = { send: vi.fn().mockRejectedValue(new Error("Network error")) };
      const store = createMockStore();
      const service = new ReliableNotificationService(notifier, defaultConfig, store);
      const result = await service.queueAlert(sampleAlert, "slack");
      expect(result.ok).toBe(false);
      const counts = store.getCounts();
      expect(counts.pending).toBe(0);
      expect(counts.retrying).toBe(1);
    });

    it("succeeds when notifier is null (log-only mode)", async () => {
      const store = createMockStore();
      const service = new ReliableNotificationService(null, defaultConfig, store);
      const result = await service.queueAlert(sampleAlert, "log");
      expect(result.ok).toBe(true);
      expect(store.getCounts().sent).toBe(1);
    });
  });

  describe("processQueue", () => {
    it("processes retrying notifications with retryBaseDelayMs=0", async () => {
      const notifier: AlertNotifier = { send: vi.fn().mockResolvedValue(undefined) };
      const store = createMockStore();
      const config: NotificationServiceConfig = { maxRetries: 3, retryBaseDelayMs: 0, idempotencyWindowS: 300 };
      const service = new ReliableNotificationService(notifier, config, store);

      await service.queueAlert(sampleAlert, "slack");

      let counts = store.getCounts();
      expect(counts.sent).toBe(1);

      const result = await service.processQueue();
      expect(result.processed).toBe(0);
    });

    it("processes failed queue items and moves to retrying", async () => {
      const notifier: AlertNotifier = { send: vi.fn().mockRejectedValue(new Error("Temporary failure")) };
      const store = createMockStore();
      const config: NotificationServiceConfig = { maxRetries: 3, retryBaseDelayMs: 0, idempotencyWindowS: 300 };
      const service = new ReliableNotificationService(notifier, config, store);

      await service.queueAlert(sampleAlert, "slack");
      expect(store.getCounts().retrying).toBe(1);

      const result = await service.processQueue();
      expect(result.processed).toBe(1);
    });

    it("moves to dead after max retries", async () => {
      const notifier: AlertNotifier = { send: vi.fn().mockRejectedValue(new Error("Always fails")) };
      const store = createMockStore();
      const config: NotificationServiceConfig = { maxRetries: 1, retryBaseDelayMs: 0, idempotencyWindowS: 300 };
      const service = new ReliableNotificationService(notifier, config, store);

      await service.queueAlert(sampleAlert, "slack");
      expect(store.getCounts().retrying).toBe(1);

      await service.processQueue();
      const counts = store.getCounts();
      expect(counts.dead).toBe(1);
    });

    it("transitions from retrying to sent on queue retry success", async () => {
      let attempts = 0;
      const notifier: AlertNotifier = {
        send: vi.fn().mockImplementation(async () => {
          attempts++;
          if (attempts < 2) throw new Error("First fail");
        }),
      };
      const store = createMockStore();
      const config: NotificationServiceConfig = { maxRetries: 3, retryBaseDelayMs: 0, idempotencyWindowS: 300 };
      const service = new ReliableNotificationService(notifier, config, store);

      await service.queueAlert(sampleAlert, "slack");
      expect(store.getCounts().retrying).toBe(1);

      await service.processQueue();
      expect(store.getCounts().sent).toBe(1);
    });

    it("processes multiple retrying notifications", async () => {
      const notifier: AlertNotifier = { send: vi.fn().mockRejectedValue(new Error("Temporary")) };
      const store = createMockStore();
      const config: NotificationServiceConfig = { maxRetries: 3, retryBaseDelayMs: 0, idempotencyWindowS: 300 };
      const service = new ReliableNotificationService(notifier, config, store);

      await service.queueAlert(sampleAlert, "slack");
      await service.queueAlert({ ...sampleAlert, ruleId: "rule2" }, "discord");
      expect(store.getCounts().retrying).toBe(2);

      const result = await service.processQueue();
      expect(result.processed).toBe(2);
      expect(result.failed).toBe(2);
    });
  });

  describe("replayDeadLetter", () => {
    it("replays a dead notification successfully", async () => {
      const failNotifier: AlertNotifier = { send: vi.fn().mockRejectedValue(new Error("Always fails")) };
      const store = createMockStore();
      const deadConfig: NotificationServiceConfig = { maxRetries: 0, retryBaseDelayMs: 0, idempotencyWindowS: 300 };
      const deadService = new ReliableNotificationService(failNotifier, deadConfig, store);

      await deadService.queueAlert(sampleAlert, "slack");
      await deadService.processQueue();
      expect(store.getCounts().dead).toBe(1);

      const okNotifier: AlertNotifier = { send: vi.fn().mockResolvedValue(undefined) };
      const replayService = new ReliableNotificationService(okNotifier, defaultConfig, store);

      const deadLetters = replayService.getDeadLetters();
      expect(deadLetters).toHaveLength(1);

      const result = await replayService.replayDeadLetter(deadLetters[0].id);
      expect(result.ok).toBe(true);
      expect(result.status).toBe("sent");
      expect(store.getCounts().sent).toBe(1);
    });

    it("returns not_found for unknown id", async () => {
      const service = new ReliableNotificationService(null, defaultConfig, createMockStore());
      const result = await service.replayDeadLetter("nonexistent");
      expect(result.ok).toBe(false);
      expect(result.status).toBe("not_found");
    });

    it("returns not_dead for notification that is sent", async () => {
      const notifier: AlertNotifier = { send: vi.fn().mockResolvedValue(undefined) };
      const store = createMockStore();
      const service = new ReliableNotificationService(notifier, defaultConfig, store);

      const { notificationId } = await service.queueAlert(sampleAlert, "slack");

      const result = await service.replayDeadLetter(notificationId);
      expect(result.ok).toBe(false);
      expect(result.status).toBe("not_dead");
    });
  });

  describe("getMetrics", () => {
    it("returns zero counts when empty", () => {
      const service = new ReliableNotificationService(null, defaultConfig, createMockStore());
      const metrics = service.getMetrics();
      expect(metrics.pending).toBe(0);
      expect(metrics.retrying).toBe(0);
      expect(metrics.sent).toBe(0);
      expect(metrics.dead).toBe(0);
    });

    it("reflects current queue state", async () => {
      const notifier: AlertNotifier = { send: vi.fn().mockResolvedValue(undefined) };
      const store = createMockStore();
      const service = new ReliableNotificationService(notifier, defaultConfig, store);

      await service.queueAlert(sampleAlert, "slack");

      const before = service.getMetrics();
      expect(before.sent).toBe(1);

      const result = await service.processQueue();
      expect(result.processed).toBe(0);

      const after = service.getMetrics();
      expect(after.sent).toBe(1);
    });
  });
});
