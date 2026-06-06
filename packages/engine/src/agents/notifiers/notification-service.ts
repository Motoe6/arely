import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { computeDelay } from "../retry-policy.js";
import type { Alert } from "../alert-rules.js";
import type { AlertNotifier } from "./notifier-types.js";
import type { NotificationStore, NotificationRecord, QueueCounts } from "./notification-store.js";
import { createNotificationStore } from "./notification-store.js";

export interface NotificationServiceConfig {
  maxRetries: number;
  retryBaseDelayMs: number;
  idempotencyWindowS: number;
}

export class ReliableNotificationService {
  private store: NotificationStore;
  private notifier: AlertNotifier | null;
  private config: NotificationServiceConfig;

  constructor(notifier: AlertNotifier | null, config: NotificationServiceConfig, store?: NotificationStore) {
    this.store = store ?? createNotificationStore();
    this.notifier = notifier;
    this.config = config;
  }

  async queueAlert(alert: Alert, channel: string): Promise<{ ok: boolean; notificationId: string }> {
    const id = ulid();
    const windowStart = Math.floor(Date.now() / (this.config.idempotencyWindowS * 1000));
    const idempotencyKey = createHash("sha256").update(alert.ruleId + alert.target + channel + String(windowStart)).digest("hex");

    this.store.insert({
      id,
      channel,
      alertJson: JSON.stringify(alert),
      idempotencyKey,
      maxRetries: this.config.maxRetries,
    });

    let ok = false;
    try {
      if (this.notifier) {
        await this.notifier.send(alert);
      }
      ok = true;
      this.store.updateStatus(id, "sent");
      this.store.insertEvent({ notificationId: id, channel, status: "sent" });
    } catch (err) {
      const errorMsg = String(err);
      this.store.updateStatus(id, "retrying", errorMsg, 0, new Date(Date.now() + this.config.retryBaseDelayMs).toISOString());
      this.store.insertEvent({ notificationId: id, channel, status: "retrying", error: errorMsg });
    }

    return { ok, notificationId: id };
  }

  async processQueue(): Promise<{ processed: number; succeeded: number; failed: number; dead: number }> {
    const now = new Date().toISOString();
    const pending = this.store.getPendingRetries(now);
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let dead = 0;

    for (const notification of pending) {
      processed++;
      const alert = JSON.parse(notification.alertJson) as Alert;

      try {
        if (this.notifier) {
          await this.notifier.send(alert);
        }
        this.store.updateStatus(notification.id, "sent");
        this.store.insertEvent({ notificationId: notification.id, channel: notification.channel, status: "sent" });
        succeeded++;
      } catch (err) {
        const errorMsg = String(err);
        const nextRetryCount = notification.retryCount + 1;

        if (nextRetryCount >= notification.maxRetries) {
          this.store.updateStatus(notification.id, "dead", errorMsg);
          this.store.insertEvent({ notificationId: notification.id, channel: notification.channel, status: "dead", error: errorMsg });
          dead++;
        } else {
          const delayMs = computeDelay(nextRetryCount, this.config.retryBaseDelayMs, "exponential");
          const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
          this.store.updateStatus(notification.id, "retrying", errorMsg, nextRetryCount, nextRetryAt);
          this.store.insertEvent({ notificationId: notification.id, channel: notification.channel, status: "retrying", error: errorMsg });
          failed++;
        }
      }
    }

    return { processed, succeeded, failed, dead };
  }

  async replayDeadLetter(notificationId: string): Promise<{ ok: boolean; status: string }> {
    const notification = this.store.getById(notificationId);
    if (!notification) {
      return { ok: false, status: "not_found" };
    }
    if (notification.status !== "dead") {
      return { ok: false, status: "not_dead" };
    }

    const alert = JSON.parse(notification.alertJson) as Alert;

    try {
      if (this.notifier) {
        await this.notifier.send(alert);
      }
      this.store.updateStatus(notification.id, "sent");
      this.store.insertEvent({ notificationId: notification.id, channel: notification.channel, status: "sent" });
      return { ok: true, status: "sent" };
    } catch (err) {
      const errorMsg = String(err);
      this.store.updateStatus(notification.id, "retrying", errorMsg, 0, new Date(Date.now() + this.config.retryBaseDelayMs).toISOString());
      this.store.insertEvent({ notificationId: notification.id, channel: notification.channel, status: "retrying", error: errorMsg });
      return { ok: true, status: "retrying" };
    }
  }

  getDeadLetters(): NotificationRecord[] {
    return this.store.getDeadLetters();
  }

  getMetrics(): QueueCounts {
    return this.store.getCounts();
  }
}
