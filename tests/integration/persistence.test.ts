import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createSession, getSession, updateSessionState } from "@opencode/engine/persistence/session-store.js";
import { createMessage, getSessionMessages } from "@opencode/engine/persistence/message-store.js";
import { createToolCall, updateToolCallStatus } from "@opencode/engine/persistence/tool-call-store.js";
import { createPermissionApproval } from "@opencode/engine/persistence/permission-store.js";
import { persistEvent, getSessionEvents } from "@opencode/engine/persistence/event-store.js";

describe("Full Persistence Flow", () => {
  beforeAll(() => initTestDb());
  afterAll(() => cleanupTestDb());

  it("should persist a complete session lifecycle", () => {
    const session = createSession({ query: "lifecycle test", model: "gpt-4o", toolMode: "native" });

    updateSessionState(session.id, "running");
    expect(getSession(session.id)!.state).toBe("running");

    const msg1 = createMessage({ sessionId: session.id, role: "user", content: "hello", sequence: 1 });
    expect(msg1.role).toBe("user");

    const msg2 = createMessage({ sessionId: session.id, role: "assistant", content: "hi there", sequence: 2 });
    expect(msg2.role).toBe("assistant");

    const tc = createToolCall({ sessionId: session.id, toolName: "websearch", args: { query: "test" } });
    updateToolCallStatus(tc.id, "running");
    updateToolCallStatus(tc.id, "completed", { result: "result data" });

    updateSessionState(session.id, "completed");
    expect(getSession(session.id)!.state).toBe("completed");
    expect(getSession(session.id)!.completedAt).toBeTruthy();
  });

  it("should persist permission approvals", () => {
    const session = createSession({ query: "perm test", model: "gpt-4o", toolMode: "native" });

    const approval = createPermissionApproval({
      sessionId: session.id,
      toolName: "websearch",
      args: { query: "test" },
      mode: "ask",
      granted: true,
      responseTimeMs: 1500,
    });

    expect(approval.id).toBeTruthy();
    expect(approval.granted).toBe(true);
    expect(approval.mode).toBe("ask");
  });

  it("should persist and retrieve events", () => {
    const session = createSession({ query: "event test", model: "gpt-4o", toolMode: "native" });

    const seq1 = persistEvent(session.id, {
      id: "evt-1",
      version: 1,
      timestamp: Date.now(),
      type: "session_started" as const,
      sessionId: session.id,
      query: "test",
      model: "gpt-4o",
      toolMode: "native",
    });

    const seq2 = persistEvent(session.id, {
      id: "evt-2",
      version: 1,
      timestamp: Date.now(),
      type: "tool_call_started" as const,
      toolCallId: "tc-1",
      toolName: "websearch",
      args: { query: "test" },
    });

    expect(seq2).toBeGreaterThan(seq1);

    const events = getSessionEvents(session.id);
    expect(events.length).toBe(2);
    expect(events[0].sequence).toBe(seq1);
    expect(events[0].eventType).toBe("session_started");
    expect(events[0].eventVersion).toBe(1);
  });

  it("should maintain referential integrity with cascade delete", () => {
    const session = createSession({
      query: "cascade test",
      model: "gpt-4o",
      toolMode: "native",
    });
    createMessage({ sessionId: session.id, role: "user", content: "test", sequence: 1 });

    const messagesBefore = getSessionMessages(session.id);
    expect(messagesBefore.length).toBe(1);
  });
});

describe("Event Store", () => {
  beforeAll(() => initTestDb());
  afterAll(() => cleanupTestDb());

  it("should store event version", () => {
    const session = createSession({ query: "version test", model: "gpt-4o", toolMode: "native" });

    persistEvent(session.id, {
      id: "evt-v1",
      version: 1,
      timestamp: Date.now(),
      type: "session_completed" as const,
      sessionId: session.id,
      reason: "completed",
    });

    const events = getSessionEvents(session.id);
    expect(events[0].eventVersion).toBe(1);
  });

  it("should store correlation IDs", () => {
    const session = createSession({ query: "correlation test", model: "gpt-4o", toolMode: "native" });

    persistEvent(session.id, {
      id: "evt-c1",
      version: 1,
      timestamp: Date.now(),
      type: "tool_call_started" as const,
      toolCallId: "tc-corr",
      toolName: "websearch",
      args: { query: "test" },
      correlationId: "corr-123",
    });

    const events = getSessionEvents(session.id);
    expect(events[0].correlationId).toBe("corr-123");
  });
});
