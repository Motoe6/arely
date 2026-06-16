import { ulid } from "ulid";

// ── Worker identity & capabilities ──

export type WorkerCapability =
  | "llm"
  | "tool"
  | "memory"
  | "code_exec"
  | "web_search"
  | "web_fetch"
  | "file_io";

export interface WorkerInfo {
  workerId: string;
  host: string;
  port: number;
  version: string;
  capabilities: WorkerCapability[];
  providers: string[];
  models: string[];
  tags?: string[];
  startedAt: number;
}

export type WorkerStatus = "online" | "offline" | "busy" | "degraded";

export interface RegistryEntry {
  worker: WorkerInfo;
  status: WorkerStatus;
  lastHeartbeat: number;
  activeRoles: number;
  leases: number;
  avgLatencyMs: number;
  failureRate: number;
}

// ── RPC messages (WebSocket) ──

export type RpcMessage =
  | ExecuteRoleRequest
  | ExecuteRoleResponse
  | HeartbeatPing
  | HeartbeatPong
  | RegisterRequest
  | RegisterResponse
  | WorkerMetricsReport
  | LeaseRenewal
  | LeaseRevoked;

export interface ExecuteRoleRequest {
  type: "execute_role";
  correlationId: string;
  traceId: string;
  sessionId: string;
  swarmId: string;
  roleId: string;
  role: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  task: string;
  context?: string;
  timeoutMs?: number;
}

export interface ExecuteRoleResponse {
  type: "role_result";
  correlationId: string;
  traceId: string;
  sessionId: string;
  swarmId: string;
  roleId: string;
  role: string;
  workerId: string;
  success: boolean;
  latencyMs: number;
  startedAt: number;
  finishedAt: number;
  output?: string;
  error?: string;
  tokenCount?: number;
  costUsd?: number;
}

export interface HeartbeatPing {
  type: "heartbeat_ping";
  correlationId: string;
  workerId: string;
  timestamp: number;
  activeRoles: number;
  memoryMb: number;
}

export interface HeartbeatPong {
  type: "heartbeat_pong";
  correlationId: string;
  timestamp: number;
}

export interface RegisterRequest {
  type: "register";
  correlationId: string;
  worker: WorkerInfo;
}

export interface RegisterResponse {
  type: "registered";
  correlationId: string;
  coordinatorId: string;
  assignedWorkers: number;
}

export interface WorkerMetricsReport {
  type: "worker_metrics";
  correlationId: string;
  traceId: string;
  workerId: string;
  timestamp: number;
  activeRoles: number;
  avgLatencyMs: number;
  failureRate: number;
  memoryMb: number;
}

export interface LeaseRenewal {
  type: "lease_renewal";
  correlationId: string;
  leaseId: string;
  workerId: string;
  timestamp: number;
}

export interface LeaseRevoked {
  type: "lease_revoked";
  correlationId: string;
  leaseId: string;
  workerId: string;
  reason: string;
  timestamp: number;
}

// ── Scheduler types ──

export type ScheduleStrategy =
  | "least_loaded"
  | "round_robin"
  | "benchmark_aware"
  | "capability_aware";

export interface ScheduleDecision {
  workerId: string;
  host: string;
  port: number;
}

// ── Leases ──

export interface Lease {
  leaseId: string;
  workerId: string;
  sessionId: string;
  roleId: string;
  role: string;
  grantedAt: number;
  expiresAt: number;
  renewedAt?: number;
  attempt: number;
}

// ── Aggregation ──

export interface SwarmExecutionResult {
  sessionId: string;
  swarmId: string;
  outputs: Record<string, string>;
  latencyMs: number;
  roleResults: RoleResult[];
  success: boolean;
}

export interface RoleResult {
  roleId: string;
  role: string;
  provider: string;
  model: string;
  success: boolean;
  latencyMs: number;
  startedAt: number;
  finishedAt: number;
  output?: string;
  error?: string;
  workerId?: string;
  tokenCount?: number;
  costUsd?: number;
}

// ── Coordinator config ──

export interface CoordinatorConfig {
  port: number;
  heartbeatTimeoutMs: number;
  heartbeatIntervalMs: number;
  leaseDurationMs: number;
  scheduleStrategy: ScheduleStrategy;
  maxRetries: number;
}

export const DEFAULT_COORDINATOR_CONFIG: CoordinatorConfig = {
  port: 9091,
  heartbeatTimeoutMs: 15_000,
  heartbeatIntervalMs: 5_000,
  leaseDurationMs: 30_000,
  scheduleStrategy: "least_loaded",
  maxRetries: 2,
};

export function newCorrelationId(): string {
  return ulid();
}

export function newTraceId(): string {
  return `dist-${ulid()}`;
}

export function newLeaseId(): string {
  return `lease-${ulid()}`;
}

export function newRoleId(): string {
  return `r_${ulid().slice(0, 16)}`;
}
