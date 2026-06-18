import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RuntimeService } from "../../packages/engine/src/runtime/runtime-service.js";

describe("RuntimeService", () => {
  beforeEach(() => {
    RuntimeService.resetInstance();
  });

  afterEach(() => {
    RuntimeService.resetInstance();
  });

  it("getInstance returns singleton", () => {
    const a = RuntimeService.getInstance();
    const b = RuntimeService.getInstance();
    expect(a).toBe(b);
  });

  it("status returns stopped initially", () => {
    const rs = RuntimeService.getInstance();
    const st = rs.status();
    expect(st.state).toBe("stopped");
    expect(st.uptimeMs).toBe(0);
    expect(st.goals.pending).toBe(0);
    expect(st.goals.running).toBe(0);
    expect(st.goals.completed).toBe(0);
    expect(st.goals.failed).toBe(0);
    expect(st.goals.blocked).toBe(0);
  });

  it("start transitions to running", () => {
    const rs = RuntimeService.getInstance();
    rs.start();
    const st = rs.status();
    expect(st.state).toBe("running");
  });

  it("start twice is idempotent", () => {
    const rs = RuntimeService.getInstance();
    rs.start();
    rs.start();
    expect(rs.status().state).toBe("running");
  });

  it("pause transitions to paused", () => {
    const rs = RuntimeService.getInstance();
    rs.start();
    rs.pause();
    expect(rs.status().state).toBe("paused");
  });

  it("pause when stopped does nothing", () => {
    const rs = RuntimeService.getInstance();
    rs.pause();
    expect(rs.status().state).toBe("stopped");
  });

  it("resume transitions back to running", () => {
    const rs = RuntimeService.getInstance();
    rs.start();
    rs.pause();
    rs.resume();
    expect(rs.status().state).toBe("running");
  });

  it("resume when running does nothing", () => {
    const rs = RuntimeService.getInstance();
    rs.start();
    rs.resume();
    expect(rs.status().state).toBe("running");
  });

  it("stop transitions to stopped", () => {
    const rs = RuntimeService.getInstance();
    rs.start();
    rs.stop();
    expect(rs.status().state).toBe("stopped");
  });

  it("stop when stopped is idempotent", () => {
    const rs = RuntimeService.getInstance();
    rs.stop();
    expect(rs.status().state).toBe("stopped");
  });

  it("status includes uptime when running", () => {
    const rs = RuntimeService.getInstance();
    rs.start();
    const st = rs.status();
    expect(st.state).toBe("running");
    expect(st.uptimeMs).toBeGreaterThanOrEqual(0);
    rs.stop();
  });

  it("status includes policies", () => {
    const rs = RuntimeService.getInstance();
    const st = rs.status();
    expect(st.policies.length).toBeGreaterThanOrEqual(7);
    expect(st.policies.find((p: { name: string }) => p.name === "maxGoalRetries")).toBeTruthy();
  });

  it("goal lifecycle via goalManager", () => {
    const rs = RuntimeService.getInstance();
    const mgr = rs.getGoalManager();
    const goal = mgr.createGoal({ description: "test goal" });
    expect(goal.status).toBe("pending");

    mgr.completeGoal(goal.id);
    const st = rs.status();
    expect(st.goals.completed).toBe(1);
  });

  it("create goal shows in goals list", () => {
    const rs = RuntimeService.getInstance();
    const mgr = rs.getGoalManager();
    mgr.createGoal({ description: "g1" });
    mgr.createGoal({ description: "g2" });
    const st = rs.status();
    expect(st.goals.pending).toBe(2);
  });

  it("retry resets a failed goal to pending", () => {
    const rs = RuntimeService.getInstance();
    const mgr = rs.getGoalManager();
    const g = mgr.createGoal({ description: "retry me", maxRetries: 1 });
    mgr.failGoal(g.id, "err");
    mgr.failGoal(g.id, "err2");
    expect(mgr.getGoal(g.id)!.status).toBe("failed");

    mgr.updateGoal(g.id, { status: "pending", retries: 0, lastError: undefined });
    expect(mgr.getGoal(g.id)!.status).toBe("pending");
    expect(mgr.getGoal(g.id)!.retries).toBe(0);
  });

  it("cancel blocks a goal", () => {
    const rs = RuntimeService.getInstance();
    const mgr = rs.getGoalManager();
    const g = mgr.createGoal({ description: "cancel me" });
    mgr.blockGoal(g.id, "Cancelled by user");
    expect(mgr.getGoal(g.id)!.status).toBe("blocked");
    expect(mgr.getGoal(g.id)!.lastError).toBe("Cancelled by user");
  });

  it("resetInstance stops and clears singleton", () => {
    const rs = RuntimeService.getInstance();
    rs.start();
    RuntimeService.resetInstance();
    const rs2 = RuntimeService.getInstance();
    expect(rs2.status().state).toBe("stopped");
    expect(rs2).not.toBe(rs);
  });

  it("status JSON serializable", () => {
    const rs = RuntimeService.getInstance();
    const st = rs.status();
    const json = JSON.stringify(st);
    expect(json).toContain('"state"');
    expect(json).toContain('"goals"');
    expect(json).toContain('"policies"');
  });

  it("events fire on lifecycle transitions", () => {
    const rs = RuntimeService.getInstance();
    const events: string[] = [];
    rs.on("runtime.started", () => events.push("started"));
    rs.on("runtime.paused", () => events.push("paused"));
    rs.on("runtime.resumed", () => events.push("resumed"));
    rs.on("runtime.stopped", () => events.push("stopped"));

    rs.start();
    // stop is async (timer-based), events fire
    expect(events).toContain("started");

    rs.pause();
    expect(events).toContain("paused");

    rs.resume();
    expect(events).toContain("resumed");

    rs.stop();
    expect(events).toContain("stopped");
  });
});
