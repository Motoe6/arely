import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createSession, getSession, updateSessionState, listSessions } from "../../src/persistence/session-store.js";
import { createMessage, getSessionMessages, getMessageCount } from "../../src/persistence/message-store.js";
import { createToolCall, updateToolCallStatus, getToolCall, getSessionToolCalls } from "../../src/persistence/tool-call-store.js";
import {
  setApproval,
  findMatchingApproval,
  clearSessionCache,
} from "../../src/persistence/approval-cache-store.js";
import { getDb } from "../../src/persistence/database.js";
import { approvalCache } from "../../src/persistence/schema.js";
import { createAuditLog, getSessionAuditLogs } from "../../src/persistence/audit-store.js";
import { getConfigValue, setConfigValue, getAllConfig, deleteConfig } from "../../src/persistence/config-store.js";

describe("Session Store", () => {
  beforeAll(() => initTestDb());
  afterAll(() => cleanupTestDb());

  it("should create and retrieve a session", () => {
    const session = createSession({ query: "test query", model: "gpt-4o", toolMode: "native" });
    expect(session.id).toBeTruthy();
    expect(session.state).toBe("idle");
    expect(session.query).toBe("test query");

    const retrieved = getSession(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(session.id);
  });

  it("should update session state", () => {
    const session = createSession({ query: "state test", model: "gpt-4o", toolMode: "native" });
    updateSessionState(session.id, "running");
    expect(getSession(session.id)!.state).toBe("running");

    updateSessionState(session.id, "completed");
    expect(getSession(session.id)!.state).toBe("completed");
    expect(getSession(session.id)!.completedAt).toBeTruthy();
  });

  it("should list sessions ordered by creation", () => {
    const sessions = listSessions();
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThan(0);
  });
});

describe("Message Store", () => {
  let sessionId: string;

  beforeAll(() => {
    initTestDb();
    sessionId = createSession({ query: "msg test", model: "gpt-4o", toolMode: "native" }).id;
  });
  afterAll(() => cleanupTestDb());

  it("should create and retrieve messages", () => {
    const msg = createMessage({ sessionId, role: "user", content: "hello", sequence: 1 });
    expect(msg.id).toBeTruthy();
    expect(msg.role).toBe("user");

    const msgs = getSessionMessages(sessionId);
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe("hello");
  });

  it("should maintain message order by sequence", () => {
    createMessage({ sessionId, role: "assistant", content: "hi there", sequence: 2 });
    createMessage({ sessionId, role: "user", content: "how are you?", sequence: 3 });

    const msgs = getSessionMessages(sessionId);
    expect(msgs.length).toBe(3);
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].sequence).toBeGreaterThan(msgs[i - 1].sequence);
    }
  });

  it("should count messages", () => {
    const count = getMessageCount(sessionId);
    expect(count).toBe(3);
  });
});

describe("Tool Call Store", () => {
  let sessionId: string;
  let toolCallId: string;

  beforeAll(() => {
    initTestDb();
    sessionId = createSession({ query: "tool test", model: "gpt-4o", toolMode: "native" }).id;
  });
  afterAll(() => cleanupTestDb());

  it("should create a tool call", () => {
    const tc = createToolCall({
      sessionId,
      toolName: "websearch",
      args: { query: "test" },
    });
    toolCallId = tc.id;
    expect(tc.status).toBe("pending");
    expect(tc.toolName).toBe("websearch");
  });

  it("should update tool call status to running", () => {
    updateToolCallStatus(toolCallId, "running");
    const tc = getToolCall(toolCallId);
    expect(tc!.status).toBe("running");
    expect(tc!.startTime).toBeTruthy();
  });

  it("should complete a tool call with result", () => {
    updateToolCallStatus(toolCallId, "completed", { result: "search results here" });
    const tc = getToolCall(toolCallId);
    expect(tc!.status).toBe("completed");
    expect(tc!.result).toBe("search results here");
    expect(tc!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should list session tool calls", () => {
    const calls = getSessionToolCalls(sessionId);
    expect(calls.length).toBe(1);
    expect(calls[0].toolName).toBe("websearch");
  });

  it("should handle failed tool calls", () => {
    const tc = createToolCall({ sessionId, toolName: "webfetch", args: { url: "https://example.com" } });
    updateToolCallStatus(tc.id, "failed", { error: "Network error" });
    const failed = getToolCall(tc.id);
    expect(failed!.status).toBe("failed");
    expect(failed!.error).toBe("Network error");
  });
});

describe("Approval Cache Store", () => {
  let sessionId: string;

  beforeAll(() => {
    initTestDb();
    sessionId = createSession({ query: "approval test", model: "gpt-4o", toolMode: "native" }).id;
  });
  afterAll(() => cleanupTestDb());

  it("should set and match approval cache entries", () => {
    setApproval({
      sessionId,
      toolName: "websearch",
      argsPattern: '{"query":"specific*"}',
      scope: "session",
      granted: true,
    });

    const match = findMatchingApproval(sessionId, "websearch", { query: "specific value" });
    expect(match).toBeDefined();
    expect(match!.granted).toBe(true);
  });

  it("should match wildcard patterns", () => {
    setApproval({
      toolName: "websearch",
      argsPattern: "*",
      scope: "forever",
      granted: false,
    });

    const match = findMatchingApproval(sessionId, "websearch", { query: "anything" });
    expect(match).toBeDefined();
    expect(match!.scope).toBe("forever");
  });

  it("should clear session cache", () => {
    clearSessionCache(sessionId);

    const all = getDb().select().from(approvalCache).all();
    const sessionEntries = all.filter((e) => e.sessionId === sessionId);
    expect(sessionEntries).toHaveLength(0);

    const match = findMatchingApproval(sessionId, "websearch", { query: "anything" });
    expect(match).toBeDefined();
    expect(match!.scope).toBe("forever");
  });
});

describe("Audit Store", () => {
  let sessionId: string;

  beforeAll(() => {
    initTestDb();
    sessionId = createSession({ query: "audit test", model: "gpt-4o", toolMode: "native" }).id;
  });
  afterAll(() => cleanupTestDb());

  it("should create and retrieve audit logs", () => {
    const entry = createAuditLog({
      sessionId,
      category: "permission",
      action: "permission_granted",
      actor: "user",
      detail: { tool: "websearch", args: { query: "test" } },
    });
    expect(entry.id).toBeTruthy();
    expect(entry.category).toBe("permission");

    const logs = getSessionAuditLogs(sessionId);
    expect(logs.length).toBe(1);
  });
});

describe("Config Store", () => {
  beforeAll(() => initTestDb());
  afterAll(() => cleanupTestDb());

  it("should set and get config values", () => {
    setConfigValue("theme", "dark");
    const val = getConfigValue("theme");
    expect(val).toBe("dark");
  });

  it("should return undefined for missing keys", () => {
    const val = getConfigValue("nonexistent");
    expect(val).toBeUndefined();
  });

  it("should list all config entries", () => {
    setConfigValue("language", "en");
    const all = getAllConfig();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("should delete config entries", () => {
    deleteConfig("theme");
    expect(getConfigValue("theme")).toBeUndefined();
  });
});
