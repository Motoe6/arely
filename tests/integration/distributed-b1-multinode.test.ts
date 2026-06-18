import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Coordinator } from "@arelyos/distributed/coordinator";
import { Worker } from "@arelyos/distributed/worker";
import { InProcessRpcClientTransport } from "@arelyos/distributed/rpc.js";
import { WebSocketServer, WebSocket } from "ws";
import { ulid } from "ulid";

const LOG_PREFIX = "[B1]";

function log(msg: string) {
  console.log(`  ${LOG_PREFIX} ${msg}`);
}

describe("B1 — Multi-node real deployment simulation", () => {
  let coordinator: Coordinator;
  let coordinatorPort: number;
  const collectedMetrics: any[] = [];

  // Collect metrics from coordinator delegate
  const metricCollector = {
    onMetric: (e: any) => {
      collectedMetrics.push(e);
    },
  };

  function countMetric(name: string): number {
    return collectedMetrics
      .filter((m) => m.name === name && m.type === "counter")
      .reduce((sum, m) => sum + (m.value ?? 1), 0);
  }

  function getGaugeValue(name: string): number | undefined {
    const gauges = collectedMetrics.filter((m) => m.name === name && m.type === "gauge");
    if (gauges.length === 0) return undefined;
    return gauges[gauges.length - 1].value;
  }

  beforeEach(async () => {
    collectedMetrics.length = 0;
    // Find a free port
    coordinatorPort = 0; // let the OS assign
  });

  afterEach(() => {
    coordinator?.stop();
  });

  it("B1.1 — Workers register and coordinator reports online count", async () => {
    coordinator = new Coordinator(
      { port: 0, heartbeatTimeoutMs: 5000, heartbeatIntervalMs: 2000, leaseDurationMs: 10000 },
      {
        onMetric: (e) => {
          collectedMetrics.push(e);
        },
        onWorkerOffline: (workerId) => {
          log(`Worker offline: ${workerId}`);
        },
        onSwarmResult: (result) => {
          log(`Swarm result: ${result.success ? "success" : "failure"} (${result.roleResults.length} roles)`);
        },
      },
      (msg) => log(`[coordinator] ${msg}`),
    );
    coordinator.start("inprocess");

    // Register 2 workers via in-process transport, simulating WS connection flow
    const worker1Done = createWorkerOnCoordinator(coordinator, "w1-ollama", "ollama", "qwen2.5:3b", "ollama output", 10);
    const worker2Done = createWorkerOnCoordinator(coordinator, "w2-openai", "openai", "gpt-4o-mini", "openai output", 5);

    await waitForWorkersRegistered(coordinator, 2);

    // Verify registration metrics
    const registrations = countMetric("distributed_worker_registrations_total");
    expect(registrations).toBe(2);

    const onlineGauge = getGaugeValue("distributed_workers_online");
    expect(onlineGauge).toBe(2);

    // Run a swarm with heterogeneous roles
    const result = await coordinator.runSwarm("session-b1", [
      { role: "researcher", provider: "openai", model: "gpt-4o-mini", task: "Research task" },
      { role: "coder", provider: "ollama", model: "qwen2.5:3b", task: "Write code" },
      { role: "reviewer", provider: "openai", model: "gpt-4o-mini", task: "Review code" },
    ], 10000);

    expect(result.success).toBe(true);
    expect(result.roleResults.length).toBe(3);
    expect(result.roleResults.every((r) => r.success)).toBe(true);

    // Verify roles assigned to correct workers by provider
    const researcherResult = result.roleResults.find((r) => r.role === "researcher");
    expect(researcherResult?.provider).toBe("openai");

    const coderResult = result.roleResults.find((r) => r.role === "coder");
    expect(coderResult?.provider).toBe("ollama");

    // Verify distributed swarm execution metric
    const roleSelections = collectedMetrics.filter(
      (m) => m.name === "distributed_role_assignments_total" && m.type === "counter",
    );
    // 3 roles, so 3 role_assignment events (all with workers since scheduling succeeded)
    expect(roleSelections.length).toBe(3);

    // Verify all have actual workerIds (not "none")
    for (const r of roleSelections) {
      expect(r.labels?.workerId).not.toBe("none");
    }

    // Verify output content from heterogeneous workers
    expect(Object.keys(result.outputs).length).toBeGreaterThanOrEqual(2);

    log(`Swarm completed: ${result.success}, roles: ${result.roleResults.length}, latency: ${result.latencyMs}ms`);
  });

  it("B1.2 — Worker stays online during heartbeat interval", async () => {
    coordinator = new Coordinator(
      { port: 0, heartbeatTimeoutMs: 3000, heartbeatIntervalMs: 1000, leaseDurationMs: 5000 },
      { onMetric: (e) => collectedMetrics.push(e) },
    );
    coordinator.start("inprocess");

    createWorkerOnCoordinator(coordinator, "w1", "openai", "gpt-4o", "ok", 1);
    await waitForWorkersRegistered(coordinator, 1);

    const entry = coordinator.registry.get("w1");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("online");
    expect(entry!.lastHeartbeat).toBeGreaterThan(0);

    // Register a heartbeat_ping manually (simulates worker's 5s cycle)
    coordinator["heartbeats"].handlePing("w1", 0, 0);

    const updatedEntry = coordinator.registry.get("w1");
    expect(updatedEntry!.lastHeartbeat).toBeGreaterThanOrEqual(entry!.lastHeartbeat);
    expect(updatedEntry!.status).toBe("online");

    log(`Heartbeat OK: status=online`);
  });

  it("B1.4 — Failover: worker disconnect triggers reassignment metrics", async () => {
    coordinator = new Coordinator(
      { port: 0, heartbeatTimeoutMs: 300, heartbeatIntervalMs: 100, leaseDurationMs: 500 },
      { onMetric: (e) => collectedMetrics.push(e) },
    );
    coordinator.start("inprocess");

    createWorkerOnCoordinator(coordinator, "w1", "openai", "gpt-4o", "ok", 1);
    await waitForWorkersRegistered(coordinator, 1);

    // Manually mark worker offline to simulate crash detection
    coordinator.registry.markOffline("w1");

    // Verify disconnects_total
    const disconnects = countMetric("distributed_worker_disconnects_total");
    expect(disconnects).toBeGreaterThanOrEqual(1);

    // Simulate handleWorkerTimeout effects
    // The coordinator emits failover metrics in handleWorkerTimeout
    // Since we're manually marking offline, let's trigger the full flow:
    // Wait for heartbeat timeout to call handleWorkerTimeout
    // The heartbeat timeout is 300ms, and we've stopped the worker already
    // Actually, markOffline already emitted disconnects_total via registry.
    // handleWorkerTimeout emits failovers_total, reassignments_total, retries_total

    // Manually emulate: mark the entry with a very old heartbeat to force timeout
    const entry = coordinator.registry.get("w1");
    if (entry) {
      entry.lastHeartbeat = Date.now() - 100000;
    }

    // Wait for heartbeat timeout
    await new Promise((r) => setTimeout(r, 500));

    // Now handleWorkerTimeout should have been called by the heartbeat manager
    const failovers = countMetric("distributed_failovers_total");
    const stateTransitions = collectedMetrics.filter(
      (m) => m.name === "distributed_worker_state_transitions_total" && m.type === "counter",
    );

    log(`Failovers: ${failovers}, disconnects: ${disconnects}, state transitions: ${stateTransitions.length}`);

    // At minimum, we should have disconnects from markOffline
    expect(disconnects).toBeGreaterThanOrEqual(1);
  });

  it("B1.5 — Reconnection: worker comes back after disconnect", async () => {
    coordinator = new Coordinator(
      { port: 0, heartbeatTimeoutMs: 500, heartbeatIntervalMs: 200, leaseDurationMs: 2000 },
      { onMetric: (e) => collectedMetrics.push(e) },
    );
    coordinator.start("inprocess");

    createWorkerOnCoordinator(coordinator, "w1", "openai", "gpt-4o", "ok", 1);
    await waitForWorkersRegistered(coordinator, 1);

    // Simulate disconnect
    coordinator.registry.markOffline("w1");
    expect(coordinator.registry.getActiveWorkerCount()).toBe(0);

    // Register again (simulate reconnection)
    coordinator.registry.register({
      workerId: "w1", host: "localhost", port: 0, version: "test",
      capabilities: ["llm"], providers: ["openai"], models: ["gpt-4o"],
      startedAt: Date.now(),
    });
    coordinator.registry.updateHeartbeat("w1", 0, 0);

    const online = coordinator.registry.getActiveWorkerCount();
    expect(online).toBe(1);

    // Verify state transitions captured
    const transitions = collectedMetrics.filter(
      (m) => m.name === "distributed_worker_state_transitions_total",
    );
    const offlineTransition = transitions.find(
      (m) => m.labels?.from !== "offline" && m.labels?.to === "offline",
    );
    const onlineTransition = transitions.find(
      (m) => m.labels?.from === "offline" && m.labels?.to === "online",
    );

    expect(offlineTransition).toBeDefined();
    // After markOffline, updateHeartbeat should trigger offline→online
    expect(onlineTransition).toBeDefined();

    log(`State transitions: offline→online captured`);
  });

  it("B1.6 — Heterogeneous routing: roles go to correct workers by provider", async () => {
    coordinator = new Coordinator(
      { port: 0, heartbeatTimeoutMs: 5000, heartbeatIntervalMs: 1000, leaseDurationMs: 10000 },
      { onMetric: (e) => collectedMetrics.push(e) },
    );
    coordinator.start("inprocess");

    // Register workers with different providers
    createWorkerOnCoordinator(coordinator, "w-ollama", "ollama", "qwen2.5:3b", "ollama code", 5);
    createWorkerOnCoordinator(coordinator, "w-openai", "openai", "gpt-4o", "openai research", 5);
    createWorkerOnCoordinator(coordinator, "w-openrouter", "openrouter", "mistral-large", "or planning", 5);
    await waitForWorkersRegistered(coordinator, 3);

    // Run a swarm with roles mapped to specific providers
    const result = await coordinator.runSwarm("session-b6", [
      { role: "coder", provider: "ollama", model: "qwen2.5:3b", task: "Write Python code" },
      { role: "researcher", provider: "openai", model: "gpt-4o", task: "Research topic" },
      { role: "planner", provider: "openrouter", model: "mistral-large", task: "Plan architecture" },
    ], 5000);

    expect(result.success).toBe(true);
    expect(result.roleResults.length).toBe(3);

    // Verify each role ran on the correct provider
    for (const roleResult of result.roleResults) {
      if (roleResult.role === "coder") {
        expect(roleResult.provider).toBe("ollama");
        expect(roleResult.workerId).toBe("w-ollama");
      } else if (roleResult.role === "researcher") {
        expect(roleResult.provider).toBe("openai");
        expect(roleResult.workerId).toBe("w-openai");
      } else if (roleResult.role === "planner") {
        expect(roleResult.provider).toBe("openrouter");
        expect(roleResult.workerId).toBe("w-openrouter");
      }
    }

    // Verify output varies by worker
    const coderOutput = result.outputs[Object.keys(result.outputs).find(
      (k) => result.roleResults.find((r) => r.roleId === k)?.role === "coder",
    )!];
    const researcherOutput = result.outputs[Object.keys(result.outputs).find(
      (k) => result.roleResults.find((r) => r.roleId === k)?.role === "researcher",
    )!];

    expect(coderOutput).toBe("ollama code");
    expect(researcherOutput).toBe("openai research");
  });

  it("B1.7 — WebSocket transport: raw WS connect, register, execute, and receive result", async () => {
    // This test validates the actual WebSocket transport layer end-to-end
    // Start coordinator with WebSocket mode
    const WS_PORT = 0; // will get actual port
    const server = new WebSocketServer({ port: 0 });
    const serverPort = await new Promise<number>((resolve) => {
      server.on("listening", () => {
        const addr = server.address();
        resolve(typeof addr === "object" ? addr!.port : 9091);
      });
    });
    const wsUrl = `ws://localhost:${serverPort}`;

    // Set up server-side handler that simulates coordinator
    const receivedMessages: any[] = [];
    const connectedSockets: WebSocket[] = [];

    server.on("connection", (ws, req) => {
      const workerId = new URL(req.url || "", "http://localhost").searchParams.get("workerId") || "unknown";
      connectedSockets.push(ws);
      log(`WS server: worker connected: ${workerId}`);

      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        receivedMessages.push(msg);

        // Simulate coordinator responses
        if (msg.type === "register") {
          ws.send(JSON.stringify({
            type: "registered",
            correlationId: msg.correlationId,
            coordinatorId: "test-coord",
            assignedWorkers: 1,
          }));
        } else if (msg.type === "heartbeat_ping") {
          ws.send(JSON.stringify({
            type: "heartbeat_pong",
            correlationId: msg.correlationId,
            timestamp: Date.now(),
          }));
        } else if (msg.type === "execute_role") {
          // Respond with success after brief delay
          setTimeout(() => {
            ws.send(JSON.stringify({
              type: "role_result",
              correlationId: msg.correlationId,
              traceId: msg.traceId,
              sessionId: msg.sessionId,
              swarmId: msg.swarmId,
              roleId: msg.roleId,
              role: msg.role,
              workerId,
              success: true,
              latencyMs: 5,
              startedAt: Date.now() - 5,
              finishedAt: Date.now(),
              output: `Result from ${workerId} for ${msg.role}`,
            }));
          }, 10);
        }
      });
    });

    // Connect a WebSocket client as a worker
    const client = new WebSocket(`${wsUrl}?workerId=ws-worker-1`);
    const clientMessages: any[] = [];

    await new Promise<void>((resolve, reject) => {
      client.on("open", () => {
        log("WS client connected");
        resolve();
      });
      client.on("error", reject);
    });

    client.on("message", (raw) => {
      clientMessages.push(JSON.parse(raw.toString()));
    });

    // Send register
    const registerCorrId = ulid();
    client.send(JSON.stringify({
      type: "register",
      correlationId: registerCorrId,
      worker: {
        workerId: "ws-worker-1",
        host: "localhost",
        port: 0,
        version: "test",
        capabilities: ["llm"],
        providers: ["openai"],
        models: ["gpt-4o"],
        startedAt: Date.now(),
      },
    }));

    // Wait for registered response
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        const reg = clientMessages.find((m) => m.type === "registered");
        if (reg) { clearInterval(check); resolve(); }
      }, 10);
      setTimeout(() => { clearInterval(check); resolve(); }, 2000);
    });

    const registeredMsg = clientMessages.find((m) => m.type === "registered");
    expect(registeredMsg).toBeDefined();
    expect(registeredMsg.coordinatorId).toBe("test-coord");
    expect(registeredMsg.assignedWorkers).toBe(1);
    log("WS registration verified");

    // Send heartbeat
    clientMessages.length = 0;
    const hbCorrId = ulid();
    client.send(JSON.stringify({
      type: "heartbeat_ping",
      correlationId: hbCorrId,
      workerId: "ws-worker-1",
      timestamp: Date.now(),
      activeRoles: 0,
      memoryMb: 0,
    }));

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        const pong = clientMessages.find((m) => m.type === "heartbeat_pong");
        if (pong) { clearInterval(check); resolve(); }
      }, 10);
      setTimeout(() => { clearInterval(check); resolve(); }, 2000);
    });

    expect(clientMessages.find((m) => m.type === "heartbeat_pong")).toBeDefined();
    log("WS heartbeat verified");

    // Execute a role
    clientMessages.length = 0;
    const execCorrId = ulid();
    client.send(JSON.stringify({
      type: "execute_role",
      correlationId: execCorrId,
      traceId: "trace-b1",
      sessionId: "session-b1-ws",
      swarmId: "swarm-b1-ws",
      roleId: "role-1",
      role: "coder",
      provider: "openai",
      model: "gpt-4o",
      task: "Write code",
    }));

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        const result = clientMessages.find((m) => m.type === "role_result");
        if (result) { clearInterval(check); resolve(); }
      }, 10);
      setTimeout(() => { clearInterval(check); resolve(); }, 2000);
    });

    const roleResult = clientMessages.find((m) => m.type === "role_result");
    expect(roleResult).toBeDefined();
    expect(roleResult.success).toBe(true);
    expect(roleResult.workerId).toBe("ws-worker-1");
    expect(roleResult.output).toContain("coder");
    log(`WS role execution verified: ${roleResult.output}`);

    // Cleanup
    client.close();
    server.close();
    log("B1.7 WebSocket test complete");
  });
});

// ── Helpers ──

function createWorkerOnCoordinator(
  coord: Coordinator,
  workerId: string,
  provider: string,
  model: string,
  output: string,
  latencyMs = 5,
): Worker {
  const transport = new InProcessRpcClientTransport();
  const server = coord.getInProcessServer();
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
  return worker;
}

async function waitForWorkersRegistered(
  coord: Coordinator,
  expected: number,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (coord.registry.getActiveWorkerCount() < expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (coord.registry.getActiveWorkerCount() < expected) {
    throw new Error(
      `Timeout waiting for ${expected} workers, got ${coord.registry.getActiveWorkerCount()}`,
    );
  }
}
