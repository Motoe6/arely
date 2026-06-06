import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordNotifier } from "../../src/agents/notifiers/discord-notifier.js";
import type { Alert } from "../../src/agents/alert-rules.js";

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

describe("DiscordNotifier", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends POST request to Discord webhook", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    const notifier = new DiscordNotifier("https://discord.com/api/webhooks/xxx");
    await notifier.send(sampleAlert);
    expect(mockFetch).toHaveBeenCalledWith("https://discord.com/api/webhooks/xxx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.any(String),
      signal: expect.any(AbortSignal),
    });
  });

  it("builds correct Discord embed shape", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    const notifier = new DiscordNotifier("https://discord.com/api/webhooks/xxx");
    await notifier.send(sampleAlert);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content).toBeNull();
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].title).toBe("Alert: success_rate");
    expect(body.embeds[0].fields).toHaveLength(2);
    expect(body.embeds[0].timestamp).toBeDefined();
  });

  it("uses correct color for each severity", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    const notifier = new DiscordNotifier("https://discord.com/api/webhooks/xxx");

    await notifier.send({ ...sampleAlert, severity: "critical" });
    const criticalBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(criticalBody.embeds[0].color).toBe(0xff0000);

    mockFetch.mockClear();

    await notifier.send({ ...sampleAlert, severity: "info" });
    const infoBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(infoBody.embeds[0].color).toBe(0x00ff00);
  });

  it("throws on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal("fetch", mockFetch);
    const notifier = new DiscordNotifier("https://discord.com/api/webhooks/xxx");
    await expect(notifier.send(sampleAlert)).rejects.toThrow("Discord webhook returned 400");
  });
});
