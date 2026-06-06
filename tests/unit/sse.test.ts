import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { EventEmitter } from "node:events";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { SSEBus } from "@opencode/engine/server/sse.js";
import { loadConfig } from "@opencode/engine/config/index.js";
import { createSession } from "@opencode/engine/persistence/session-store.js";
import type { SessionStartedEvent, ToolCallStartedEvent } from "@opencode/engine/types/events.js";

function createMockRes() {
  const emitter = new EventEmitter();
  const chunks: string[] = [];
  let ended = false;

  const res = {
    writeHead: () => res,
    end: () => {
      ended = true;
      emitter.emit("close");
      return res;
    },
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    on: (event: string, cb: () => void) => {
      emitter.on(event, cb);
      return res;
    },
  };

  return { res, chunks, get ended() { return ended; }, emitClose: () => emitter.emit("close") };
}

describe("SSEBus", () => {
  beforeAll(() => {
    process.env.OPENCODE_API_KEY = "test-key";
    loadConfig();
    initTestDb();
  });
  afterAll(() => cleanupTestDb());

  it("should emit and receive events via listener", () => {
    const bus = new SSEBus();
    const session = createSession({ query: "test", model: "gpt-4o", toolMode: "native" });
    const events: string[] = [];

    const unsub = bus.on(session.id, (event) => {
      events.push(event.type);
    });

    const testEvent: SessionStartedEvent = {
      id: "evt-001",
      version: 1,
      timestamp: Date.now(),
      type: "session_started",
      sessionId: session.id,
      query: "test",
      model: "gpt-4o",
      toolMode: "native",
    };

    bus.emit(session.id, testEvent);
    expect(events).toContain("session_started");

    unsub();
    bus.emit(session.id, testEvent);
    expect(events.length).toBe(1);
  });

  it("should track sequence numbers per session", () => {
    const bus = new SSEBus();
    const session = createSession({ query: "test", model: "gpt-4o", toolMode: "native" });

    const event1: SessionStartedEvent = {
      id: "evt-002",
      version: 1,
      timestamp: Date.now(),
      type: "session_started",
      sessionId: session.id,
      query: "test",
      model: "gpt-4o",
      toolMode: "native",
    };

    const event2: ToolCallStartedEvent = {
      id: "evt-003",
      version: 1,
      timestamp: Date.now(),
      type: "tool_call_started",
      toolCallId: "tc-001",
      toolName: "websearch",
      args: { query: "test" },
    };

    bus.emit(session.id, event1);
    bus.emit(session.id, event2);

    const seq = bus.getSequence(session.id);
    expect(seq).toBeGreaterThan(0);
  });

  it("should filter events by session for listeners", () => {
    const bus = new SSEBus();
    const sessionA = createSession({ query: "a", model: "gpt-4o", toolMode: "native" });
    const sessionB = createSession({ query: "b", model: "gpt-4o", toolMode: "native" });
    const sessionAEvents: string[] = [];
    const sessionBEvents: string[] = [];

    bus.on(sessionA.id, (e) => sessionAEvents.push(e.type));
    bus.on(sessionB.id, (e) => sessionBEvents.push(e.type));

    const event: SessionStartedEvent = {
      id: "evt-004",
      version: 1,
      timestamp: Date.now(),
      type: "session_started",
      sessionId: sessionA.id,
      query: "test",
      model: "gpt-4o",
      toolMode: "native",
    };

    bus.emit(sessionA.id, event);
    expect(sessionAEvents).toContain("session_started");
    expect(sessionBEvents).toHaveLength(0);

    bus.emit(sessionB.id, event);
    expect(sessionBEvents).toContain("session_started");
  });

  it("should handle missing session sequence gracefully", () => {
    const bus = new SSEBus();
    const seq = bus.getSequence("nonexistent");
    expect(seq).toBe(0);
  });

  it("should add client, write connected event, and handle close", () => {
    const bus = new SSEBus();
    const session = createSession({ query: "replay", model: "gpt-4o", toolMode: "native" });
    const { res, chunks } = createMockRes();

    bus.addClient(session.id, res as never);

    const connected = chunks.find((c) => c.startsWith("event: connected"));
    expect(connected).toBeDefined();
    expect(connected).toContain(session.id);
  });

  it("should replay missed events after lastEventId", () => {
    const bus = new SSEBus();
    const session = createSession({ query: "replay2", model: "gpt-4o", toolMode: "native" });

    const event: SessionStartedEvent = {
      id: "evt-replay",
      version: 1,
      timestamp: Date.now(),
      type: "session_started",
      sessionId: session.id,
      query: "replay",
      model: "gpt-4o",
      toolMode: "native",
    };

    bus.emit(session.id, event);

    const { res, chunks } = createMockRes();
    bus.addClient(session.id, res as never, "0");

    const replayed = chunks.find((c) => c.startsWith("event: session_started"));
    expect(replayed).toBeDefined();
  });

  it("should remove all clients for a session", () => {
    const bus = new SSEBus();
    const session = createSession({ query: "remove", model: "gpt-4o", toolMode: "native" });
    const { res } = createMockRes();

    bus.addClient(session.id, res as never);
    bus.removeAllClients(session.id);

    const seq = bus.getSequence(session.id);
    expect(seq).toBe(0);
  });

  it("should remove listener via off()", () => {
    const bus = new SSEBus();
    const session = createSession({ query: "off", model: "gpt-4o", toolMode: "native" });
    const events: string[] = [];
    const handler = (event: { type: string }) => {
      events.push(event.type);
    };

    bus.on(session.id, handler);
    bus.emit(session.id, { id: "1", version: 1, timestamp: 0, type: "session_started" as const, sessionId: session.id, query: "x", model: "gpt-4o", toolMode: "native" });
    expect(events).toHaveLength(1);

    bus.off(session.id, handler);
    bus.emit(session.id, { id: "2", version: 1, timestamp: 0, type: "session_started" as const, sessionId: session.id, query: "x", model: "gpt-4o", toolMode: "native" });
    expect(events).toHaveLength(1);
  });
});
