import type { AlertNotifier } from "./notifier-types.js";
import type { Alert } from "../alert-rules.js";

export interface EmailTransport {
  sendMail(opts: Record<string, unknown>): Promise<unknown>;
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  from: string;
  to: string;
}

export class EmailNotifier implements AlertNotifier {
  constructor(
    private config: EmailConfig,
    private transport: EmailTransport,
  ) {}

  async send(alert: Alert): Promise<void> {
    const html = [
      "<h2>Alert: " + alert.severity + "</h2>",
      "<table>",
      "<tr><td>Rule</td><td>" + alert.ruleId + "</td></tr>",
      "<tr><td>Category</td><td>" + alert.category + "</td></tr>",
      "<tr><td>Message</td><td>" + alert.message + "</td></tr>",
      "<tr><td>Metric</td><td>" + String(alert.metric) + "</td></tr>",
      "<tr><td>Threshold</td><td>" + String(alert.threshold) + "</td></tr>",
      "<tr><td>Target</td><td>" + alert.target + "</td></tr>",
      "</table>",
    ].join("\n");

    await this.transport.sendMail({
      from: this.config.from,
      to: this.config.to,
      subject: "[" + alert.severity + "] Alert: " + alert.category + " — " + alert.target,
      html,
    });
  }
}
