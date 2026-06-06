import type { Alert } from "../alert-rules.js";

export interface AlertNotifier {
  send(alert: Alert): Promise<void>;
}

export interface NotificationConfig {
  log?: boolean;
  webhookUrl?: string;
  slackWebhookUrl?: string;
  discordWebhookUrl?: string;
  email?: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
    from: string;
    to: string;
  };
}
