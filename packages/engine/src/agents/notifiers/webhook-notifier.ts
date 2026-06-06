import type { AlertNotifier } from "./notifier-types.js";
import type { Alert } from "../alert-rules.js";

export class WebhookNotifier implements AlertNotifier {
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  async send(alert: Alert): Promise<void> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "alert",
        severity: alert.severity,
        category: alert.category,
        message: alert.message,
        metric: alert.metric,
        threshold: alert.threshold,
        target: alert.target,
        ruleId: alert.ruleId,
        timestamp: alert.createdAt,
      }),
    });
    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`);
    }
  }
}
