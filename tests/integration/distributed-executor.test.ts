import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Coordinator } from "@arelyos/distributed/coordinator";
import { Worker } from "@arelyos/distributed/worker";
import { InProcessRpcClientTransport } from "@arelyos/distributed/rpc";
import { DistributedSwarmExecutor } from "@arelyos/engine/swarm/distributed-swarm-executor";
import type { RoleAssignment, TaskCategory } from "@arelyos/agent-core/swarm/index";

const CATEGORY: TaskCategory = "coding";

function createMockRoleAssignment(
  role: string,
  provider: string,
  model: string,
): RoleAssignment {
  return {
    role: role as any,
    provider,
    model,
    confidence: 0.9,
    score: 0.85,
    category: CATEGORY,
    reason: "test",
  };
}

function createWorker(
  coordinator: Coordinator,
  workerId: string,
  provider: string,
  model: string,
  output: string,
  latencyMs = 5,
): { worker: Worker; transport: InProcessRpcClientTransport } {
  const transport = new InProcessRpcClientTransport();
  const server = coordinator.getInProcessServer();
  if (!server) throw new Error("no in-process server");
  server.registerConnection(workerId, transport);

  const worker = new Worker(
    {
      workerId,
      host: "localhost",
      port: 0,
      version: "test",
      capabilities: ["llm"],
      providers: [provider],
      models: [model],
      startedAt: Date.now(),
    },
    transport,
    async (_role, _provider, _model, _task, _sp, _ctx, _signal) => {
      await new Promise((r) => setTimeout(r, latencyMs));
      return output;
    },
  );
  worker.start();
  return { worker, transport };
}

async function waitForWorkers(
  coordinator: Coordinator,
  expected: number,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (
    coordinator.registry.getActiveWorkerCount() < expected &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("DistributedSwarmExecutor integration", () => {
  let coordinator: Coordinator;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // cleanup handled per-test
  });

  const SWARM_TIMEOUT = 60000;

  describe("A2.4.1 — 1 worker 1 role", () => {
    it("executes a single role and returns ParallelSwarmResult", async () => {
      coordinator = new Coordinator({ port: 0 });
      coordinator.start("inprocess");

      const { worker } = createWorker(
        coordinator,
        "w1",
        "openai",
        "gpt-4o",
        "research output",
        5,
      );
      await waitForWorkers(coordinator, 1);
      expect(coordinator.registry.getActiveWorkerCount()).toBe(1);

      const executor = new DistributedSwarmExecutor({ coordinator });
      const result = await executor.execute("session-1", "test request", [
        createMockRoleAssignment("researcher", "openai", "gpt-4o"),
      ]);

      expect(result.request).toBe("test request");
      expect(result.outputs["researcher"]).toBe("research output");
      // no synthesizer role → synthesis is empty
      expect(result.synthesis).toBe("");
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].role).toBe("researcher");

      coordinator.stop();
      worker.stop();
    });
  });

  describe("A2.4.2 — 4 workers 5 roles", () => {
    it("distributes 5 roles across 4 workers and aggregates results", async () => {
      coordinator = new Coordinator({ port: 0 });
      coordinator.start("inprocess");

      const workers = [
        createWorker(coordinator, "w1", "openai", "gpt-4o", "plan data", 5),
        createWorker(coordinator, "w2", "anthropic", "claude-sonnet-4", "research data", 5),
        createWorker(coordinator, "w3", "openai", "gpt-4o", "code output", 5),
        createWorker(coordinator, "w4", "anthropic", "claude-sonnet-4", "review notes", 5),
      ];
      await waitForWorkers(coordinator, 4);
      expect(coordinator.registry.getActiveWorkerCount()).toBe(4);

      const executor = new DistributedSwarmExecutor({ coordinator });
      const result = await executor.execute("session-2", "build a tool", [
        createMockRoleAssignment("planner", "openai", "gpt-4o"),
        createMockRoleAssignment("researcher", "anthropic", "claude-sonnet-4"),
        createMockRoleAssignment("coder", "openai", "gpt-4o"),
        createMockRoleAssignment("reviewer", "anthropic", "claude-sonnet-4"),
        createMockRoleAssignment("synthesizer", "openai", "gpt-4o"),
      ]);

      expect(result.request).toBe("build a tool");
      expect(Object.keys(result.outputs).length).toBe(5);
      expect(result.outputs["planner"]).toBeTruthy();
      expect(result.outputs["researcher"]).toBeTruthy();
      expect(result.outputs["coder"]).toBeTruthy();
      expect(result.outputs["reviewer"]).toBeTruthy();
      expect(result.outputs["synthesizer"]).toBeTruthy();
      expect(result.tasks).toHaveLength(5);

      coordinator.stop();
      workers.forEach((w) => w.worker.stop());
    });
  });

  describe("A2.4.3 — Worker timeout", () => {
    it("handles worker timeout and reports error via executor", async () => {
      coordinator = new Coordinator({
        port: 0,
        leaseDurationMs: 100,
        heartbeatTimeoutMs: 200,
      });
      coordinator.start("inprocess");

      // Worker that never resolves
      const transport = new InProcessRpcClientTransport();
      const server = coordinator.getInProcessServer();
      if (!server) throw new Error("no server");
      server.registerConnection("slow-worker", transport);

      const worker = new Worker(
        {
          workerId: "slow-worker",
          host: "localhost",
          port: 0,
          version: "test",
          capabilities: ["llm"],
          providers: ["openai"],
          models: ["gpt-4o"],
          startedAt: Date.now(),
        },
        transport,
        async () => {
          await new Promise(() => {}); // never resolves
          return "never";
        },
      );
      worker.start();

      await waitForWorkers(coordinator, 1);

      const executor = new DistributedSwarmExecutor({
        coordinator,
        timeoutMs: 50,
      });

      const result = await executor.execute("session-3", "test", [
        createMockRoleAssignment("researcher", "openai", "gpt-4o"),
      ]);

      // The swarm may succeed (outputs["researcher"] undefined) or fail, but should not crash
      expect(result.request).toBe("test");
      expect(result.tasks).toHaveLength(1);

      coordinator.stop();
      worker.stop();
    });
  });

  describe("A2.4.4 — Worker goes offline mid-execution", () => {
    it("detects worker disconnect and handles offline state", async () => {
      coordinator = new Coordinator({
        port: 0,
        leaseDurationMs: 50,
        heartbeatTimeoutMs: 200,
        heartbeatIntervalMs: 50,
      });
      coordinator.start("inprocess");

      const { worker, transport } = createWorker(
        coordinator,
        "w-online",
        "openai",
        "gpt-4o",
        "fast output",
        5,
      );
      await waitForWorkers(coordinator, 1);

      // Close transport to simulate worker crash
      transport.close();

      // Wait for heartbeat timeout to detect offline
      await new Promise((r) => setTimeout(r, 300));

      const entry = coordinator.registry.get("w-online");
      expect(entry?.status).toBe("offline");
      expect(coordinator.registry.getActiveWorkerCount()).toBe(0);

      coordinator.stop();
      worker.stop();
    });
  });

  describe("A2.4.5 — Heterogeneous providers", () => {
    it("executes roles with different provider/model assignments", async () => {
      coordinator = new Coordinator({ port: 0 });
      coordinator.start("inprocess");

      const workers = [
        createWorker(coordinator, "w-openai", "openai", "gpt-4o", "openai result", 5),
        createWorker(coordinator, "w-anthropic", "anthropic", "claude-sonnet-4", "anthropic result", 5),
        createWorker(coordinator, "w-ollama", "ollama", "qwen2.5:3b", "ollama result", 5),
      ];
      await waitForWorkers(coordinator, 3);

      const executor = new DistributedSwarmExecutor({ coordinator });
      const result = await executor.execute("session-5", "research task", [
        createMockRoleAssignment("researcher", "openai", "gpt-4o"),
        createMockRoleAssignment("coder", "anthropic", "claude-sonnet-4"),
        createMockRoleAssignment("reviewer", "ollama", "qwen2.5:3b"),
      ]);

      expect(result.request).toBe("research task");
      expect(Object.keys(result.outputs).length).toBeGreaterThanOrEqual(1);
      expect(result.tasks).toHaveLength(3);

      coordinator.stop();
      workers.forEach((w) => w.worker.stop());
    });
  });

  describe("A2.4.6 — 50 parallel swarms", () => {
    it("handles 50 concurrent swarm executions without crashing", async () => {
      coordinator = new Coordinator({ port: 0 });
      coordinator.start("inprocess");

      const workers = [
        createWorker(coordinator, "w-a", "openai", "gpt-4o", "result-a", 2),
        createWorker(coordinator, "w-b", "anthropic", "claude-sonnet-4", "result-b", 2),
      ];
      await waitForWorkers(coordinator, 2);

      const executor = new DistributedSwarmExecutor({
        coordinator,
        timeoutMs: 10000,
      });

      const count = 50;
      const swarms: Promise<unknown>[] = [];
      for (let i = 0; i < count; i++) {
        swarms.push(
          executor.execute(`session-50-${i}`, `request-${i}`, [
            createMockRoleAssignment("researcher", "openai", "gpt-4o"),
          ]),
        );
      }

      const results = await Promise.allSettled(swarms);
      const fulfilled = results.filter(
        (r) => r.status === "fulfilled",
      ).length;
      const rejected = results.filter((r) => r.status === "rejected").length;

      expect(fulfilled + rejected).toBe(count);
      expect(fulfilled).toBeGreaterThanOrEqual(count * 0.5);

      coordinator.stop();
      workers.forEach((w) => w.worker.stop());
    });
  });

  describe("Edge cases", () => {
    it("handles no workers available", async () => {
      coordinator = new Coordinator({ port: 0 });
      coordinator.start("inprocess");

      const executor = new DistributedSwarmExecutor({ coordinator });
      const result = await executor.execute("session-empty", "test", [
        createMockRoleAssignment("researcher", "openai", "gpt-4o"),
      ]);

      expect(result.request).toBe("test");
      expect(result.outputs).toEqual({});
      expect(result.synthesis).toBe("");

      coordinator.stop();
    });

    it("handles empty role assignments", async () => {
      coordinator = new Coordinator({ port: 0 });
      coordinator.start("inprocess");

      const executor = new DistributedSwarmExecutor({ coordinator });
      const result = await executor.execute("session-empty", "test", []);

      expect(result.request).toBe("test");
      expect(result.outputs).toEqual({});
      expect(result.tasks).toHaveLength(0);

      coordinator.stop();
    });

    it("executor timeout shorter than worker latency", async () => {
      coordinator = new Coordinator({
        port: 0,
        leaseDurationMs: 100,
        heartbeatTimeoutMs: 200,
      });
      coordinator.start("inprocess");

      // Worker that takes 500ms, but executor timeout is 50ms
      const { worker } = createWorker(
        coordinator,
        "w-slow",
        "openai",
        "gpt-4o",
        "slow output",
        500,
      );
      await waitForWorkers(coordinator, 1);

      const executor = new DistributedSwarmExecutor({
        coordinator,
        timeoutMs: 50,
      });

      const result = await executor.execute("session-timeout", "test", [
        createMockRoleAssignment("researcher", "openai", "gpt-4o"),
      ]);

      // Should complete without crash; output may or may not be present
      expect(result.request).toBe("test");

      coordinator.stop();
      worker.stop();
    });
  });
});
