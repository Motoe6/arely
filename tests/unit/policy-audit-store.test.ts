import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import {
  insertEvent,
  getTrace,
  listTraces,
  countTraces,
  prune,
} from "../../src/persistence/policy-audit-store.js";

describe("Policy Audit Store", () => {
  const traceA = "trace-a";
  const traceB = "trace-b";

  beforeAll(() => {
    initTestDb();
    insertEvent(traceA, "cycle_started", { metrics: { successRate: 0.95 }, policyHash: "abc123" });
    insertEvent(traceA, "rule_matched", { ruleId: "r1", action: "trigger_remediation", conditions: { retryRate: { lt: 0.1 } } });
    insertEvent(traceA, "cycle_completed", { actions: [{ ruleId: "r1", action: "trigger_remediation" }] });
    insertEvent(traceB, "cycle_started", { metrics: { successRate: 0.7 }, policyHash: "def456" });
    insertEvent(traceB, "cycle_completed", { actions: [] });
  });

  afterAll(() => cleanupTestDb());

  it("getTrace should return events for an existing trace ordered by created_at", () => {
    const events = getTrace(traceA);
    expect(events.length).toBe(3);
    expect(events[0].eventType).toBe("cycle_started");
    expect(events[1].eventType).toBe("rule_matched");
    expect(events[2].eventType).toBe("cycle_completed");
  });

  it("getTrace should parse payload as object", () => {
    const events = getTrace(traceA);
    const started = events.find((e) => e.eventType === "cycle_started");
    expect(started).toBeDefined();
    expect(started!.payload).toEqual({ metrics: { successRate: 0.95 }, policyHash: "abc123" });
  });

  it("getTrace should return empty array for unknown traceId", () => {
    const events = getTrace("nonexistent");
    expect(events).toEqual([]);
  });

  it("listTraces should return all traces with event counts", () => {
    const traces = listTraces();
    expect(traces.length).toBe(2);
    const a = traces.find((t) => t.traceId === traceA);
    const b = traces.find((t) => t.traceId === traceB);
    expect(a).toBeDefined();
    expect(a!.eventCount).toBe(3);
    expect(b).toBeDefined();
    expect(b!.eventCount).toBe(2);
  });

  it("listTraces should respect limit and offset", () => {
    const first = listTraces(1, 0);
    expect(first.length).toBe(1);
    const second = listTraces(1, 1);
    expect(second.length).toBe(1);
    expect(second[0].traceId).not.toBe(first[0].traceId);
  });

  it("listTraces should return ordered results", () => {
    const traces = listTraces();
    expect(traces.length).toBe(2);
    expect(traces.every((t) => t.createdAt.length > 0)).toBe(true);
  });

  it("countTraces should return the number of distinct traces", () => {
    const count = countTraces();
    expect(count).toBe(2);
  });

  it("prune should remove traces older than retention days", () => {
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    insertEvent("old-trace", "cycle_started", { metrics: { successRate: 0.5 } }, oldDate);
    expect(countTraces()).toBe(3);
    const removed = prune(1);
    expect(removed).toBe(1);
    expect(countTraces()).toBe(2);
    expect(getTrace("old-trace")).toEqual([]);
  });

  it("prune should return 0 when no traces exceed retention", () => {
    const removed = prune(100);
    expect(removed).toBe(0);
    expect(countTraces()).toBe(2);
  });

  it("insertEvent should accept complex payloads", () => {
    insertEvent(traceA, "remediation_executed", {
      ruleId: "r1",
      action: "trigger_remediation",
      details: { channels: ["slack"], message: "Alert!" },
    });
    const events = getTrace(traceA);
    const rem = events.find((e) => e.eventType === "remediation_executed");
    expect(rem).toBeDefined();
    expect((rem!.payload as Record<string, unknown>).details).toEqual({ channels: ["slack"], message: "Alert!" });
  });
});
