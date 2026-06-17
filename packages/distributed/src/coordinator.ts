import type { RpcMessage, ExecuteRoleRequest, ExecuteRoleResponse, CoordinatorConfig, RoleResult, SwarmExecutionResult } from "./types.js";
import { newCorrelationId, newTraceId, newRoleId, DEFAULT_COORDINATOR_CONFIG } from "./types.js";
import { WorkerRegistry } from "./registry.js";
import { WebSocketRpcServer, InProcessRpcServer } from "./rpc.js";
import type { RpcTransport } from "./rpc.js";
import { LeaseManager } from "./lease-manager.js";
import { SwarmScheduler } from "./scheduler.js";
import { HeartbeatManager } from "./heartbeat.js";
import type { MetricEvent } from "./metric-events.js";
import {
  METRIC_WORKER_REGISTRATIONS_TOTAL,
  METRIC_WORKER_DISCONNECTS_TOTAL,
  METRIC_WORKERS_ONLINE,
  METRIC_LEASES_ACTIVE,
  METRIC_ROLE_ASSIGNMENTS_TOTAL,
  METRIC_RPC_REQUESTS_TOTAL,
  METRIC_RPC_TIMEOUTS_TOTAL,
  METRIC_FAILOVERS_TOTAL,
  METRIC_REASSIGNMENTS_TOTAL,
  METRIC_ROLE_RETRIES_TOTAL,
  METRIC_ROLES_RUNNING,
  METRIC_SWARM_LATENCY_MS,
  METRIC_STALE_RESULTS_TOTAL,
  METRIC_COORDINATOR_RESTARTS_TOTAL,
} from "./metric-events.js";

export type RpcMode = "inprocess" | "websocket";

export interface CoordinatorDelegate {
  onSwarmResult?(result: SwarmExecutionResult): void;
  onWorkerOffline?(workerId: string): void;
  onError?(error: Error): void;
  onMetric?(event: MetricEvent): void;
}

export class Coordinator {
  readonly config: CoordinatorConfig;
  readonly registry: WorkerRegistry;
  readonly leases: LeaseManager;
  readonly scheduler: SwarmScheduler;
  readonly heartbeats: HeartbeatManager;

  private wsServer: WebSocketRpcServer | null = null;
  private ipServer: InProcessRpcServer | null = null;
  private delegate?: CoordinatorDelegate;
  private log: (msg: string) => void;

  // Role correlation: correlationId → { resolver, role, provider, model }
  private roleResolvers = new Map<string, {
    resolver: (res: ExecuteRoleResponse) => void;
    role: string;
    provider: string;
    model: string;
  }>();

  constructor(config?: Partial<CoordinatorConfig>, delegate?: CoordinatorDelegate, log?: (msg: string) => void) {
    this.config = { ...DEFAULT_COORDINATOR_CONFIG, ...config };
    this.delegate = delegate;
    this.log = log ?? (() => {});
    const emit = (e: MetricEvent) => this.delegate?.onMetric?.(e);
    this.registry = new WorkerRegistry(emit, log);
    this.leases = new LeaseManager(this.config, emit, log);
    this.scheduler = new SwarmScheduler(this.registry, this.leases, this.config.scheduleStrategy, emit);
    this.heartbeats = new HeartbeatManager(
      this.registry,
      this.config,
      (workerId) => this.handleWorkerTimeout(workerId),
      log,
    );
  }

  start(mode: RpcMode = "inprocess"): void {
    this.heartbeats.start();
    this.delegate?.onMetric?.({ type: "counter", name: METRIC_COORDINATOR_RESTARTS_TOTAL });

    const handler = (msg: RpcMessage) => this.handleMessage(msg);

    if (mode === "websocket") {
      this.wsServer = new WebSocketRpcServer(this.log);
      this.wsServer.start(this.config.port);
      this.wsServer.onMessage(handler);
      this.log(`Coordinator started (WebSocket mode on port ${this.config.port})`);
    } else {
      this.ipServer = new InProcessRpcServer(this.log);
      this.ipServer.onMessage(handler);
      this.log(`Coordinator started (in-process mode)`);
    }
  }

  stop(): void {
    this.heartbeats.stop();
    if (this.wsServer) { this.wsServer.stop(); this.wsServer = null; }
    if (this.ipServer) { this.ipServer.closeAll(); this.ipServer = null; }
    this.registry.reset();
  }

  getInProcessServer(): InProcessRpcServer | null {
    return this.ipServer;
  }

  sendTo(workerId: string, msg: RpcMessage): boolean {
    if (this.wsServer?.sendTo(workerId, msg)) return true;
    if (this.ipServer?.sendTo(workerId, msg)) return true;
    return false;
  }

  // ── Orchestrate a full swarm execution ──

  async runSwarm(
    sessionId: string,
    roleAssignments: Array<{
      roleId?: string;
      role: string;
      provider: string;
      model: string;
      systemPrompt?: string;
      task: string;
      context?: string;
      requiredCapabilities?: string[];
    }>,
    timeoutMs?: number,
  ): Promise<SwarmExecutionResult> {
    const traceId = newTraceId();
    const swarmId = `swarm-${traceId.slice(5, 21)}`;
    const startMs = Date.now();

    const roleResults: RoleResult[] = [];
    const outputs: Record<string, string> = {};
    const total = roleAssignments.length;
    const correlationIds: string[] = [];

    for (const assignment of roleAssignments) {
      const roleId = assignment.roleId ?? newRoleId();
      const decision = this.scheduler.schedule(roleId, assignment.role, assignment.provider, assignment.requiredCapabilities);

      if (!decision) {
        this.delegate?.onMetric?.({ type: "counter", name: METRIC_ROLE_ASSIGNMENTS_TOTAL, labels: { role: assignment.role, provider: assignment.provider, model: assignment.model, workerId: "none" } });
        roleResults.push({
          roleId,
          role: assignment.role,
          provider: assignment.provider,
          model: assignment.model,
          success: false,
          latencyMs: 0,
          startedAt: Date.now(),
          finishedAt: Date.now(),
          error: "No available worker",
        });
        continue;
      }

      this.delegate?.onMetric?.({ type: "counter", name: METRIC_ROLE_ASSIGNMENTS_TOTAL, labels: { role: assignment.role, provider: assignment.provider, model: assignment.model, workerId: decision.workerId } });
      this.delegate?.onMetric?.({ type: "gauge", name: METRIC_ROLES_RUNNING, value: this.roleResolvers.size + 1 });

      const correlationId = newCorrelationId();
      correlationIds.push(correlationId);
      this.leases.grant(decision.workerId, sessionId, roleId, assignment.role);
      this.registry.incrementLeases(decision.workerId);

      const request: ExecuteRoleRequest = {
        type: "execute_role",
        correlationId,
        traceId,
        sessionId,
        swarmId,
        roleId,
        role: assignment.role,
        provider: assignment.provider,
        model: assignment.model,
        systemPrompt: assignment.systemPrompt,
        task: assignment.task,
        context: assignment.context,
        timeoutMs,
      };

      // Create promise that resolves when role_result with matching correlationId arrives
      const rolePromise = new Promise<void>((resolve) => {
        this.roleResolvers.set(correlationId, {
          resolver: (res) => {
          this.leases.revokeByWorker(decision!.workerId, "role_completed");
          this.registry.decrementLeases(decision!.workerId);

          const roleRes: RoleResult = {
            roleId: res.roleId,
            role: res.role,
            provider: assignment.provider,
            model: assignment.model,
            success: res.success,
            latencyMs: res.latencyMs,
            startedAt: res.startedAt,
            finishedAt: res.finishedAt,
            output: res.output,
            error: res.error,
            workerId: res.workerId,
          };
          roleResults.push(roleRes);
          if (res.output) outputs[roleId] = res.output;
          resolve();
        },
          role: assignment.role,
          provider: assignment.provider,
          model: assignment.model,
        });
      });

      this.sendTo(decision.workerId, request);
    }

    // Wait for all dispatched roles, with timeout
    if (total > 0) {
      const deadline = Date.now() + (timeoutMs ?? 60000);
      while (correlationIds.some((cid) => this.roleResolvers.has(cid)) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
      // Clean up any timed-out resolvers and push timeout errors
      const now = Date.now();
      for (const cid of correlationIds) {
        const entry = this.roleResolvers.get(cid);
        if (entry) {
          this.delegate?.onMetric?.({ type: "counter", name: METRIC_RPC_TIMEOUTS_TOTAL, labels: { workerId: "unknown", role: entry.role } });
          roleResults.push({
            roleId: "",
            role: entry.role,
            provider: entry.provider,
            model: entry.model,
            success: false,
            latencyMs: now - startMs,
            startedAt: startMs,
            finishedAt: now,
            error: "worker timed out",
          });
          this.roleResolvers.delete(cid);
        }
      }
    }

    const totalMs = Date.now() - startMs;
    this.delegate?.onMetric?.({ type: "histogram", name: METRIC_SWARM_LATENCY_MS, durationMs: totalMs });
    const successCount = roleResults.filter((r) => r.success).length;
    const success = total > 0 && successCount > 0;

    const result: SwarmExecutionResult = {
      sessionId,
      swarmId,
      outputs,
      latencyMs: totalMs,
      roleResults,
      success,
    };

    this.delegate?.onSwarmResult?.(result);
    return result;
  }

  // ── Message handling ──

  private handleMessage(msg: RpcMessage): void {
    this.delegate?.onMetric?.({ type: "counter", name: METRIC_RPC_REQUESTS_TOTAL, labels: { messageType: msg.type } });

    switch (msg.type) {
      case "role_result": {
        const entry = this.roleResolvers.get(msg.correlationId);
        if (entry) {
          entry.resolver(msg);
          this.roleResolvers.delete(msg.correlationId);
        } else {
          // Stale result — role already timed out or reassigned
          this.delegate?.onMetric?.({ type: "counter", name: METRIC_STALE_RESULTS_TOTAL, labels: { workerId: msg.workerId, role: msg.role } });
        }
        break;
      }
      case "heartbeat_ping": {
        const pong = this.heartbeats.handlePing(msg.workerId, msg.activeRoles, msg.memoryMb);
        this.sendTo(msg.workerId, pong);
        break;
      }
      case "register":
        this.registry.register(msg.worker);
        this.delegate?.onMetric?.({ type: "counter", name: METRIC_WORKER_REGISTRATIONS_TOTAL, labels: { workerId: msg.worker.workerId } });
        this.delegate?.onMetric?.({ type: "gauge", name: METRIC_WORKERS_ONLINE, value: this.registry.getActiveWorkerCount() });
        this.sendTo(msg.worker.workerId, {
          type: "registered",
          correlationId: msg.correlationId,
          coordinatorId: "coordinator-1",
          assignedWorkers: this.registry.getActiveWorkerCount(),
        });
        break;
      case "worker_metrics":
        this.registry.updateMetrics(msg.workerId, msg.avgLatencyMs, msg.failureRate);
        break;
      case "lease_renewal":
        this.leases.renew(msg.leaseId);
        break;
    }
  }

  private handleWorkerTimeout(workerId: string): void {
    const affectedRoles = this.leases.revokeByWorker(workerId, "heartbeat_timeout");
    this.delegate?.onWorkerOffline?.(workerId);
    // markOffline emits disconnects_total + updates workers_online gauge
    this.registry.markOffline(workerId);
    this.delegate?.onMetric?.({ type: "counter", name: METRIC_FAILOVERS_TOTAL, labels: { workerId } });
    this.delegate?.onMetric?.({ type: "counter", name: METRIC_REASSIGNMENTS_TOTAL, labels: { workerId }, value: affectedRoles });
    this.delegate?.onMetric?.({ type: "counter", name: METRIC_ROLE_RETRIES_TOTAL, labels: { workerId }, value: affectedRoles });
  }

  getPendingRoleCount(): number {
    return this.roleResolvers.size;
  }
}
