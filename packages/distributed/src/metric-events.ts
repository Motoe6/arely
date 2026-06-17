export interface MetricEvent {
  type: "counter" | "gauge" | "histogram";
  name: string;
  labels?: Record<string, string>;
  value?: number;
  durationMs?: number;
}

export type MetricEmitter = (event: MetricEvent) => void;

// ── Workers ──

export const METRIC_WORKERS_TOTAL = "distributed_workers_total";
export const METRIC_WORKERS_ONLINE = "distributed_workers_online";
export const METRIC_WORKERS_BUSY = "distributed_workers_busy";
export const METRIC_WORKERS_DEGRADED = "distributed_workers_degraded";
export const METRIC_WORKER_DISCONNECTS_TOTAL = "distributed_worker_disconnects_total";
export const METRIC_WORKER_REGISTRATIONS_TOTAL = "distributed_worker_registrations_total";

// ── Leases ──

export const METRIC_LEASES_ACTIVE = "distributed_leases_active";
export const METRIC_LEASES_GRANTED_TOTAL = "distributed_leases_granted_total";
export const METRIC_LEASES_EXPIRED_TOTAL = "distributed_leases_expired_total";
export const METRIC_LEASES_REVOKED_TOTAL = "distributed_leases_revoked_total";
export const METRIC_LEASE_DURATION_MS = "distributed_lease_duration_ms";

// ── Scheduling ──

export const METRIC_ROLE_ASSIGNMENTS_TOTAL = "distributed_role_assignments_total";
export const METRIC_SCHEDULER_DECISIONS_TOTAL = "distributed_scheduler_decisions_total";
export const METRIC_SCHEDULER_LATENCY_MS = "distributed_scheduler_latency_ms";
export const METRIC_ROLES_RUNNING = "distributed_roles_running";
export const METRIC_ROLES_QUEUED = "distributed_roles_queued";
export const METRIC_ROLE_RETRIES_TOTAL = "distributed_role_retries_total";

// ── RPC ──

export const METRIC_RPC_REQUESTS_TOTAL = "distributed_rpc_requests_total";
export const METRIC_RPC_FAILURES_TOTAL = "distributed_rpc_failures_total";
export const METRIC_RPC_LATENCY_MS = "distributed_rpc_latency_ms";
export const METRIC_RPC_TIMEOUTS_TOTAL = "distributed_rpc_timeouts_total";

// ── Swarms ──

export const METRIC_SWARMS_TOTAL = "distributed_swarms_total";
export const METRIC_SWARM_LATENCY_MS = "distributed_swarm_latency_ms";
export const METRIC_SWARM_FAILURES_TOTAL = "distributed_swarm_failures_total";
export const METRIC_FAILOVERS_TOTAL = "distributed_failovers_total";
export const METRIC_REASSIGNMENTS_TOTAL = "distributed_reassignments_total";
export const METRIC_STALE_RESULTS_TOTAL = "distributed_stale_results_total";
export const METRIC_WORKER_STATE_TRANSITIONS_TOTAL = "distributed_worker_state_transitions_total";
export const METRIC_COORDINATOR_RESTARTS_TOTAL = "distributed_coordinator_restarts_total";

// ── Discovery ──

export const METRIC_DISCOVERED_WORKERS_TOTAL = "distributed_discovered_workers_total";
export const METRIC_WORKER_JOINS_TOTAL = "distributed_worker_joins_total";
export const METRIC_WORKER_LEAVES_TOTAL = "distributed_worker_leaves_total";
export const METRIC_DISCOVERY_ERRORS_TOTAL = "distributed_discovery_errors_total";
export const METRIC_DISCOVERY_LATENCY_MS = "distributed_discovery_latency_ms";
