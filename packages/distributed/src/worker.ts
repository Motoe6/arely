import { ulid } from "ulid";
import type { RpcMessage, WorkerInfo, ExecuteRoleRequest, ExecuteRoleResponse } from "./types.js";
import { newCorrelationId } from "./types.js";
import type { CoordinatorRpcServer } from "./rpc.js";

export type RoleExecutor = (
  role: string,
  provider: string,
  model: string,
  task: string,
  systemPrompt?: string,
  context?: string,
  signal?: AbortSignal,
) => Promise<string>;

export class Worker {
  readonly info: WorkerInfo;
  private rpc: CoordinatorRpcServer;
  private executeRole: RoleExecutor;
  private activeRoles = new Set<string>();
  private totalLatencyMs = 0;
  private totalRoles = 0;
  private totalFailures = 0;
  private heartbeatIntervalId: ReturnType<typeof setInterval> | undefined;
  private log: (msg: string) => void;

  constructor(
    info: WorkerInfo,
    rpc: CoordinatorRpcServer,
    executeRole: RoleExecutor,
    log?: (msg: string) => void,
  ) {
    this.info = info;
    this.rpc = rpc;
    this.executeRole = executeRole;
    this.log = log ?? (() => {});
  }

  start(): void {
    // Register with coordinator
    this.rpc.sendTo("coordinator", {
      type: "register",
      correlationId: newCorrelationId(),
      worker: this.info,
    });
    this.log(`Worker ${this.info.workerId} registered with coordinator`);

    // Start heartbeats
    this.heartbeatIntervalId = setInterval(() => this.sendHeartbeat(), 5000);

    // Listen for messages
    this.rpc.onMessage((msg) => this.handleMessage(msg));
  }

  stop(): void {
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = undefined;
    }
    this.activeRoles.clear();
  }

  private handleMessage(msg: RpcMessage): void {
    switch (msg.type) {
      case "execute_role":
        this.handleExecuteRole(msg);
        break;
    }
  }

  private async handleExecuteRole(msg: ExecuteRoleRequest): Promise<void> {
    this.activeRoles.add(msg.roleId);
    const startMs = Date.now();
    let success = false;
    let output: string | undefined;
    let error: string | undefined;

    try {
      const signal = msg.timeoutMs ? AbortSignal.timeout(msg.timeoutMs) : undefined;
      output = await this.executeRole(
        msg.role,
        msg.provider,
        msg.model,
        msg.task,
        msg.systemPrompt,
        msg.context,
        signal,
      );
      success = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      this.totalFailures++;
    }

    const finishedAt = Date.now();
    const latencyMs = finishedAt - startMs;

    this.totalLatencyMs += latencyMs;
    this.totalRoles++;
    this.activeRoles.delete(msg.roleId);

    const response: ExecuteRoleResponse = {
      type: "role_result",
      correlationId: msg.correlationId,
      traceId: msg.traceId,
      sessionId: msg.sessionId,
      swarmId: msg.swarmId,
      roleId: msg.roleId,
      role: msg.role,
      workerId: this.info.workerId,
      success,
      latencyMs,
      startedAt: startMs,
      finishedAt,
      output,
      error,
    };

    this.rpc.sendTo("coordinator", response);
    this.log(`Role ${msg.roleId} (${msg.role}) completed: ${success ? "ok" : "fail"} (${latencyMs}ms)`);
  }

  private sendHeartbeat(): void {
    this.rpc.sendTo("coordinator", {
      type: "heartbeat_ping",
      correlationId: newCorrelationId(),
      workerId: this.info.workerId,
      timestamp: Date.now(),
      activeRoles: this.activeRoles.size,
      memoryMb: 0,
    });
  }

  getActiveRoleCount(): number {
    return this.activeRoles.size;
  }

  getAvgLatencyMs(): number {
    return this.totalRoles > 0 ? this.totalLatencyMs / this.totalRoles : 0;
  }

  getFailureRate(): number {
    return this.totalRoles > 0 ? this.totalFailures / this.totalRoles : 0;
  }
}
