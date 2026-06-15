import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlackNotifier } from "@arely/engine/agents/notifiers/slack-notifier.js";
import type { Alert } from "@arely/engine/agents/alert-rules.js";

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

describe("SlackNotifier", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends POST request to Slack webhook", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    const notifier = new SlackNotifier("https://hooks.slack.com/services/xxx");
    await notifier.send(sampleAlert);
    expect(mockFetch).toHaveBeenCalledWith("https://hooks.slack.com/services/xxx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.any(String),
      signal: expect.any(AbortSignal),
    });
  });

  it("builds correct Slack payload shape", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    const notifier = new SlackNotifier("https://hooks.slack.com/services/xxx");
    await notifier.send(sampleAlert);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("warning");
    expect(body.text).toContain("success_rate");
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].color).toBe("warning");
    expect(body.attachments[0].fields).toHaveLength(4);
  });

  it("uses danger color for critical severity", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    const notifier = new SlackNotifier("https://hooks.slack.com/services/xxx");
    await notifier.send({ ...sampleAlert, severity: "critical" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.attachments[0].color).toBe("danger");
  });

  it("throws on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", mockFetch);
    const notifier = new SlackNotifier("https://hooks.slack.com/services/xxx");
    await expect(notifier.send(sampleAlert)).rejects.toThrow("Slack webhook returned 500");
  });
});
