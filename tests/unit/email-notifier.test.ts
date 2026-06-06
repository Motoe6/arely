import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmailNotifier, type EmailConfig, type EmailTransport } from "@opencode/engine/agents/notifiers/email-notifier.js";
import type { Alert } from "@opencode/engine/agents/alert-rules.js";

const sampleAlert: Alert = {
  ruleId: "test_rule",
  severity: "warning",
  category: "success_rate",
  message: "Test alert message",
  metric: 0.5,
  threshold: 0.8,
  target: "test_tool",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const emailConfig: EmailConfig = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  auth: { user: "alice", pass: "secret" },
  from: "alice@example.com",
  to: "ops@example.com",
};

describe("EmailNotifier", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends email via transport", async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: ["ops@example.com"] });
    const transport: EmailTransport = { sendMail };
    const notifier = new EmailNotifier(emailConfig, transport);
    await notifier.send(sampleAlert);
    expect(sendMail).toHaveBeenCalledOnce();
    const opts = sendMail.mock.calls[0][0];
    expect(opts.from).toBe("alice@example.com");
    expect(opts.to).toBe("ops@example.com");
    expect(opts.subject).toContain("warning");
    expect(opts.subject).toContain("success_rate");
    expect(opts.subject).toContain("test_tool");
    expect(opts.html).toContain("<h2>");
    expect(opts.html).toContain("Test alert message");
    expect(opts.html).toContain("0.5");
  });

  it("propagates transport errors", async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error("SMTP connection refused"));
    const transport: EmailTransport = { sendMail };
    const notifier = new EmailNotifier(emailConfig, transport);
    await expect(notifier.send(sampleAlert)).rejects.toThrow("SMTP connection refused");
  });

  it("includes all alert fields in HTML body", async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    const transport: EmailTransport = { sendMail };
    const notifier = new EmailNotifier(emailConfig, transport);
    await notifier.send({ ...sampleAlert, severity: "critical", metric: 0.3, threshold: 0.9 });
    const html = sendMail.mock.calls[0][0].html as string;
    expect(html).toContain("critical");
    expect(html).toContain("test_rule");
    expect(html).toContain("0.3");
    expect(html).toContain("0.9");
  });
});
