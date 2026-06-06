import { describe, it, expect, vi, beforeEach } from "vitest";
import { LogNotifier } from "@opencode/engine/agents/notifiers/log-notifier.js";
import { WebhookNotifier } from "@opencode/engine/agents/notifiers/webhook-notifier.js";
import { CompositeNotifier, createNotifiers } from "@opencode/engine/agents/notifiers/notifier.js";
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

describe("LogNotifier", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("logs alert info", async () => {
    const logger = await import("@opencode/engine/logger.js");
    const infoSpy = vi.spyOn(logger.logger, "info").mockImplementation(() => {});
    const notifier = new LogNotifier();
    await notifier.send(sampleAlert);
    expect(infoSpy).toHaveBeenCalledWith("notifier", expect.stringContaining("Test alert"), expect.anything());
  });

  it("handles critical severity", async () => {
    const logger = await import("@opencode/engine/logger.js");
    const infoSpy = vi.spyOn(logger.logger, "info").mockImplementation(() => {});
    const notifier = new LogNotifier();
    await notifier.send({ ...sampleAlert, severity: "critical", message: "Critical alert" });
    expect(infoSpy).toHaveBeenCalledWith("notifier", expect.stringContaining("critical"), expect.anything());
  });
});

describe("WebhookNotifier", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends POST request to webhook URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    const notifier = new WebhookNotifier("https://hooks.example.com/alerts");
    await notifier.send(sampleAlert);
    expect(mockFetch).toHaveBeenCalledWith("https://hooks.example.com/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.any(String),
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event).toBe("alert");
    expect(body.severity).toBe("warning");
    expect(body.message).toBe("Test alert");
  });

  it("throws on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", mockFetch);
    const notifier = new WebhookNotifier("https://hooks.example.com/alerts");
    await expect(notifier.send(sampleAlert)).rejects.toThrow("Webhook returned 500");
  });

  it("throws on network error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network failure"));
    vi.stubGlobal("fetch", mockFetch);
    const notifier = new WebhookNotifier("https://hooks.example.com/alerts");
    await expect(notifier.send(sampleAlert)).rejects.toThrow("Network failure");
  });
});

describe("CompositeNotifier", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends to all notifiers", async () => {
    const a = { send: vi.fn().mockResolvedValue(undefined) };
    const b = { send: vi.fn().mockResolvedValue(undefined) };
    const composite = new CompositeNotifier([a, b]);
    await composite.send(sampleAlert);
    expect(a.send).toHaveBeenCalledWith(sampleAlert);
    expect(b.send).toHaveBeenCalledWith(sampleAlert);
  });

  it("continues on notifier failure", async () => {
    const a = { send: vi.fn().mockRejectedValue(new Error("fail")) };
    const b = { send: vi.fn().mockResolvedValue(undefined) };
    const composite = new CompositeNotifier([a, b]);
    await expect(composite.send(sampleAlert)).resolves.toBeUndefined();
    expect(b.send).toHaveBeenCalledWith(sampleAlert);
  });

  it("handles empty notifiers", async () => {
    const composite = new CompositeNotifier([]);
    await expect(composite.send(sampleAlert)).resolves.toBeUndefined();
  });
});

describe("createNotifiers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("creates log notifier when log config is true", () => {
    const result = createNotifiers({ log: true });
    expect(result).toBeInstanceOf(CompositeNotifier);
  });

  it("creates webhook notifier when webhookUrl is set", () => {
    const result = createNotifiers({ webhookUrl: "https://hooks.example.com/alerts" });
    expect(result).toBeInstanceOf(CompositeNotifier);
  });

  it("creates both notifiers when both configs are set", () => {
    const result = createNotifiers({ log: true, webhookUrl: "https://hooks.example.com/alerts" });
    expect(result).toBeInstanceOf(CompositeNotifier);
  });

  it("creates empty composite when no config is set", () => {
    const result = createNotifiers({});
    expect(result).toBeInstanceOf(CompositeNotifier);
  });

  it("creates slack notifier when slackWebhookUrl is set", () => {
    const result = createNotifiers({ slackWebhookUrl: "https://hooks.slack.com/services/xxx" });
    expect(result).toBeInstanceOf(CompositeNotifier);
  });

  it("creates discord notifier when discordWebhookUrl is set", () => {
    const result = createNotifiers({ discordWebhookUrl: "https://discord.com/api/webhooks/xxx" });
    expect(result).toBeInstanceOf(CompositeNotifier);
  });

  it("creates all notifiers when all configs are set", () => {
    const result = createNotifiers({
      log: true,
      slackWebhookUrl: "https://hooks.slack.com/services/xxx",
      discordWebhookUrl: "https://discord.com/api/webhooks/xxx",
    });
    expect(result).toBeInstanceOf(CompositeNotifier);
  });
});
