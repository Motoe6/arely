import type { AlertNotifier } from "./notifier-types.js";
import type { Alert } from "../alert-rules.js";

export class SlackNotifier implements AlertNotifier {
  constructor(private webhookUrl: string) {}

  async send(alert: Alert): Promise<void> {
    const payload = {
      text: `[${alert.severity}] Alert: ${alert.category} — ${alert.message}`,
      attachments: [
        {
          color:
            alert.severity === "critical"
              ? "danger"
              : alert.severity === "warning"
                ? "warning"
                : "good",
          fields: [
            { title: "Rule", value: alert.ruleId, short: true },
            { title: "Target", value: alert.target, short: true },
            { title: "Metric", value: String(alert.metric), short: true },
            { title: "Threshold", value: String(alert.threshold), short: true },
          ],
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Slack webhook returned ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
