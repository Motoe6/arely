import type { AlertNotifier } from "./notifier-types.js";
import type { Alert } from "../alert-rules.js";

export class DiscordNotifier implements AlertNotifier {
  constructor(private webhookUrl: string) {}

  async send(alert: Alert): Promise<void> {
    const color =
      alert.severity === "critical"
        ? 0xff0000
        : alert.severity === "warning"
          ? 0xffa500
          : 0x00ff00;

    const payload = {
      content: null,
      embeds: [
        {
          title: `Alert: ${alert.category}`,
          description: alert.message,
          color,
          fields: [
            { name: "Rule", value: alert.ruleId, inline: true },
            { name: "Target", value: alert.target, inline: true },
          ],
          timestamp: new Date().toISOString(),
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
        throw new Error(`Discord webhook returned ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
