import type { AlertNotifier, NotificationConfig } from "./notifier-types.js";
import type { Alert } from "../alert-rules.js";
import { LogNotifier } from "./log-notifier.js";
import { WebhookNotifier } from "./webhook-notifier.js";
import { SlackNotifier } from "./slack-notifier.js";
import { DiscordNotifier } from "./discord-notifier.js";
import { EmailNotifier } from "./email-notifier.js";
import nodemailer from "nodemailer";

export type { AlertNotifier, NotificationConfig };

export class CompositeNotifier implements AlertNotifier {
  private notifiers: AlertNotifier[];

  constructor(notifiers: AlertNotifier[]) {
    this.notifiers = notifiers;
  }

  async send(alert: Alert): Promise<void> {
    await Promise.all(this.notifiers.map((n) => n.send(alert).catch(() => {})));
  }
}

export async function sendAlerts(notifier: AlertNotifier | null, alerts: Alert[]): Promise<void> {
  if (!notifier) return;
  await Promise.all(alerts.map((a) => notifier.send(a).catch(() => {})));
}

export function createNotifiers(config: NotificationConfig): AlertNotifier {
  const notifiers: AlertNotifier[] = [];
  if (config.log) {
    notifiers.push(new LogNotifier());
  }
  if (config.webhookUrl) {
    notifiers.push(new WebhookNotifier(config.webhookUrl));
  }
  if (config.slackWebhookUrl) {
    notifiers.push(new SlackNotifier(config.slackWebhookUrl));
  }
  if (config.discordWebhookUrl) {
    notifiers.push(new DiscordNotifier(config.discordWebhookUrl));
  }
  const email = config.email;
  const emailReady =
    email?.host &&
    email?.auth?.user &&
    email?.auth?.pass &&
    email?.from &&
    email?.to;
  if (emailReady) {
    const transport = nodemailer.createTransport({
      host: email.host,
      port: email.port,
      secure: email.secure,
      auth: email.auth,
    });
    notifiers.push(new EmailNotifier(email, transport));
  }
  return new CompositeNotifier(notifiers);
}
