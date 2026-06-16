import type { RpcMessage, ExecuteRoleRequest, ExecuteRoleResponse, CoordinatorConfig, RoleResult, SwarmExecutionResult } from "./types.js";
import { newCorrelationId, newTraceId, newRoleId, DEFAULT_COORDINATOR_CONFIG } from "./types.js";
import { WorkerRegistry } from "./registry.js";
import { CoordinatorRpcServer } from "./rpc.js";
import { LeaseManager } from "./lease-manager.js";
import { SwarmScheduler } from "./scheduler.js";
import { HeartbeatManager } from "./heartbeat.js";

export interface CoordinatorDelegate {
  onSwarmResult?(result: SwarmExecutionResult): void;
  onWorkerOffline?(workerId: string): void;
  onError?(error: Error): void;
}

export class Coordinator {
  readonly config: CoordinatorConfig;
  readonly registry: WorkerRegistry;
  readonly rpc: CoordinatorRpcServer;
  readonly leases: LeaseManager;
  readonly scheduler: SwarmScheduler;
  readonly heartbeats: HeartbeatManager;

  private delegate?: CoordinatorDelegate;
  private pendingRoles = new Map<string, { request: ExecuteRoleRequest; startedAt: number; retries: number }>();
  private swarmResults = new Map<string, { results: RoleResult[]; startedAt: number }>();

  constructor(config?: Partial<CoordinatorConfig>, delegate?: CoordinatorDelegate, log?: (msg: string) => void) {
    this.config = { ...DEFAULT_COORDINATOR_CONFIG, ...config };
    this.registry = new WorkerRegistry(log);
    this.rpc = new CoordinatorRpcServer(log);
    this.leases = new LeaseManager(this.config, log);
    this.scheduler = new SwarmScheduler(this.registry, this.leases, this.config.scheduleStrategy);
    this.delegate = delegate;

    this.heartbeats = new HeartbeatManager(
      this.registry,
      this.config,
      (workerId) => this.handleWorkerTimeout(workerId),
      log,
    );

    this.rpc.onMessage((msg) => this.handleMessage(msg));
  }

  start(): void {
    this.heartbeats.start();
  }

  stop(): void {
    this.heartbeats.stop();
    this.rpc.closeAll();
    this.registry.reset();
    this.pendingRoles.clear();
    this.swarmResults.clear();
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

    const swarmResult: RoleResult[] = [];
    const outputs: Record<string, string> = {};

    for (const assignment of roleAssignments) {
      const roleId = assignment.roleId ?? newRoleId();
      const decision = this.scheduler.schedule(roleId, assignment.role, assignment.provider, assignment.requiredCapabilities);

      if (!decision) {
        swarmResult.push({
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

      const correlationId = newCorrelationId();
      const lease = this.leases.grant(decision.workerId, sessionId, roleId, assignment.role);
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

      this.rpc.sendTo(decision.workerId, request);
      this.pendingRoles.set(correlationId, { request, startedAt: Date.now(), retries: 0 });

      // Wait for response (simplified: await directly via in-process transport)
      // In real WebSocket mode, we'd use pendingRoles + message handler
    }

    // In in-process mode, responses are handled synchronously via message handler
    // Wait a tick for responses to be processed
    await new Promise((r) => setTimeout(r, 0));

    const totalMs = Date.now() - startMs;
    const successCount = swarmResult.filter((r) => r.success).length;
    const success = swarmResult.length > 0 && successCount > 0;

    const result: SwarmExecutionResult = {
      sessionId,
      swarmId,
      outputs,
      latencyMs: totalMs,
      roleResults: swarmResult,
      success,
    };

    this.swarmResults.set(swarmId, { results: swarmResult, startedAt: startMs });
    this.delegate?.onSwarmResult?.(result);

    return result;
  }

  // ── Message handling ──

  private handleMessage(msg: RpcMessage): void {
    switch (msg.type) {
      case "role_result":
        this.handleRoleResult(msg);
        break;
      case "heartbeat_ping":
        this.handleHeartbeat(msg);
        break;
      case "register":
        this.handleRegister(msg);
        break;
      case "worker_metrics":
        this.handleMetrics(msg);
        break;
      case "lease_renewal":
        this.handleLeaseRenewal(msg);
        break;
    }
  }

  private handleRegister(msg: RpcMessage & { type: "register" }): void {
    this.registry.register(msg.worker);
    this.rpc.sendTo(msg.worker.workerId, {
      type: "registered",
      correlationId: msg.correlationId,
      coordinatorId: "coordinator-1",
      assignedWorkers: this.registry.getActiveWorkerCount(),
    });
  }

  private handleRoleResult(msg: ExecuteRoleResponse): void {
    const pending = this.pendingRoles.get(msg.correlationId);
    if (!pending) return;
    this.pendingRoles.delete(msg.correlationId);
    this.leases.revokeByWorker(msg.workerId, "role_completed");
    this.registry.decrementLeases(msg.workerId);

    // Update swarm result
    const swarmResult = this.swarmResults.get(msg.swarmId);
    if (swarmResult) {
      swarmResult.results.push({
        roleId: msg.roleId,
        role: msg.role,
        provider: msg.provider ?? pending.request.provider,
        model: msg.model ?? pending.request.model,
        success: msg.success,
        latencyMs: msg.latencyMs,
        startedAt: msg.startedAt,
        finishedAt: msg.finishedAt,
        output: msg.output,
        error: msg.error,
        workerId: msg.workerId,
      });
      if (msg.output) {
        // Track output per role
        const resultObj = this.swarmResults.get(msg.swarmId);
        if (resultObj) {
          // outputs are built at aggregation time
        }
      }
    }
  }

  private handleHeartbeat(msg: RpcMessage & { type: "heartbeat_ping" }): void {
    const pong = this.heartbeats.handlePing(msg.workerId, msg.activeRoles, msg.memoryMb);
    this.rpc.sendTo(msg.workerId, pong);
  }

  private handleMetrics(msg: RpcMessage & { type: "worker_metrics" }): void {
    this.registry.updateMetrics(msg.workerId, msg.avgLatencyMs, msg.failureRate);
  }

  private handleLeaseRenewal(msg: RpcMessage & { type: "lease_renewal" }): void {
    this.leases.renew(msg.leaseId);
  }

  private handleWorkerTimeout(workerId: string): void {
    this.leases.revokeByWorker(workerId, "heartbeat_timeout");
    this.rpc.removeConnection(workerId);
    this.delegate?.onWorkerOffline?.(workerId);
  }

  // ── Public API ──

  getPendingRoleCount(): number {
    return this.pendingRoles.size;
  }

  getActiveSwarmCount(): number {
    return this.swarmResults.size;
  }
}
