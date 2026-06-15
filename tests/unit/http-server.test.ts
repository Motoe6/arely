import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHttpServer } from "@arelyos/engine/transport/http-server.js";
import { SSEBus } from "@arelyos/engine/server/sse.js";
import { connect, close } from "@arelyos/engine/persistence/database.js";
import { loadConfig } from "@arelyos/engine/config/index.js";
import { createSession } from "@arelyos/engine/persistence/session-store.js";
import http from "node:http";
import type { SessionStartedEvent } from "@arelyos/engine/types/events.js";

function fetchUrl(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }));
    }).on("error", (err: Error) => reject(err));
  });
}

function listenOnRandomPort(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      resolve(typeof addr === "object" ? addr!.port : 0);
    });
  });
}

describe("HTTP Server", () => {
  const sse = new SSEBus();

  beforeAll(() => {
    process.env.ARELY_API_KEY = "test-key";
    loadConfig();
    connect(":memory:");
  });
  afterAll(() => close());

  it("should create and start a server", () => {
    const server = createHttpServer({ sse, port: 0 });
    expect(server).toBeDefined();
    server.close();
  });

  it("should respond to GET /health", async () => {
    const server = createHttpServer({ sse, port: 0 });
    const port = await listenOnRandomPort(server);
    const { statusCode, body } = await fetchUrl(`http://localhost:${port}/health`);
    expect(statusCode).toBe(200);
    const data = JSON.parse(body);
    expect(data.ok).toBe(true);
    server.close();
  });

  it("should respond to GET /ready with DB connected", async () => {
    const server = createHttpServer({ sse, port: 0 });
    const port = await listenOnRandomPort(server);
    const { statusCode, body } = await fetchUrl(`http://localhost:${port}/ready`);
    expect(statusCode).toBe(200);
    const data = JSON.parse(body);
    expect(data.ok).toBe(true);
    expect(data.db).toBe(true);
    server.close();
  });

  it("should respond to GET /deps", async () => {
    const server = createHttpServer({ sse, port: 0 });
    const port = await listenOnRandomPort(server);
    const { statusCode, body } = await fetchUrl(`http://localhost:${port}/deps`);
    expect(statusCode).toBe(200);
    const data = JSON.parse(body);
    expect(data.db.ok).toBe(true);
    expect(typeof data.db.latencyMs).toBe("number");
    server.close();
  });

  it("should respond to GET /ready with DB unavailable", async () => {
    close();

    const server = createHttpServer({ sse, port: 0 });
    const port = await listenOnRandomPort(server);
    const { statusCode } = await fetchUrl(`http://localhost:${port}/ready`);
    expect(statusCode).toBe(503);
    server.close();

    connect(":memory:");
  });

  describe("GET /api/sse/replay", () => {
    let replaySessionId = "";

    beforeAll(() => {
      const session = createSession({ query: "replay-test", model: "gpt-4o", toolMode: "native" });
      replaySessionId = session.id;

      const event: SessionStartedEvent = {
        id: "replay-evt-1",
        version: 1,
        timestamp: Date.now(),
        type: "session_started",
        sessionId: replaySessionId,
        query: "replay-test",
        model: "gpt-4o",
        toolMode: "native",
      };
      sse.emit(replaySessionId, event);
    });

    it("should cap limit at MAX_REPLAY_BATCH_SIZE", async () => {
      const server = createHttpServer({ sse, port: 0 });
      const port = await listenOnRandomPort(server);
      const { statusCode, body } = await fetchUrl(
        `http://localhost:${port}/api/sse/replay?sessionId=${replaySessionId}&limit=999999`,
      );
      expect(statusCode).toBe(200);
      const data = JSON.parse(body);
      expect(data.limit).toBeLessThanOrEqual(5000);
      server.close();
    });

    it("should fall back to default for negative limit", async () => {
      const server = createHttpServer({ sse, port: 0 });
      const port = await listenOnRandomPort(server);
      const { statusCode, body } = await fetchUrl(
        `http://localhost:${port}/api/sse/replay?sessionId=${replaySessionId}&limit=-1`,
      );
      expect(statusCode).toBe(200);
      const data = JSON.parse(body);
      expect(data.limit).toBeGreaterThan(0);
      expect(data.limit).toBeLessThanOrEqual(5000);
      server.close();
    });

    it("should fall back to default for invalid limit string", async () => {
      const server = createHttpServer({ sse, port: 0 });
      const port = await listenOnRandomPort(server);
      const { statusCode, body } = await fetchUrl(
        `http://localhost:${port}/api/sse/replay?sessionId=${replaySessionId}&limit=abc`,
      );
      expect(statusCode).toBe(200);
      const data = JSON.parse(body);
      expect(data.limit).toBeGreaterThan(0);
      expect(data.limit).toBeLessThanOrEqual(5000);
      server.close();
    });
  });
});
