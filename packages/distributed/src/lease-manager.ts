import type { Lease, CoordinatorConfig } from "./types.js";
import { newLeaseId } from "./types.js";
import type { MetricEmitter } from "./metric-events.js";
import {
  METRIC_LEASES_ACTIVE,
  METRIC_LEASES_GRANTED_TOTAL,
  METRIC_LEASES_EXPIRED_TOTAL,
  METRIC_LEASES_REVOKED_TOTAL,
  METRIC_LEASE_DURATION_MS,
} from "./metric-events.js";

export class LeaseManager {
  private leases = new Map<string, Lease>();
  private config: CoordinatorConfig;
  private log: (msg: string) => void;
  private emit: MetricEmitter;

  constructor(config: CoordinatorConfig, emit?: MetricEmitter, log?: (msg: string) => void) {
    this.config = config;
    this.emit = emit ?? (() => {});
    this.log = log ?? (() => {});
  }

  grant(workerId: string, sessionId: string, roleId: string, role: string): Lease {
    const now = Date.now();
    const lease: Lease = {
      leaseId: newLeaseId(),
      workerId,
      sessionId,
      roleId,
      role,
      grantedAt: now,
      expiresAt: now + this.config.leaseDurationMs,
      attempt: 1,
    };
    this.leases.set(lease.leaseId, lease);
    this.emit({ type: "counter", name: METRIC_LEASES_GRANTED_TOTAL, labels: { workerId, role } });
    this.emit({ type: "gauge", name: METRIC_LEASES_ACTIVE, value: this.leases.size });
    return lease;
  }

  renew(leaseId: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease) return false;
    const now = Date.now();
    const elapsed = now - lease.grantedAt;
    lease.renewedAt = now;
    lease.expiresAt = now + this.config.leaseDurationMs;
    lease.attempt++;
    this.emit({ type: "histogram", name: METRIC_LEASE_DURATION_MS, durationMs: elapsed });
    return true;
  }

  revoke(leaseId: string, reason: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease) return false;
    this.log(`Lease ${leaseId} (${lease.role} on ${lease.workerId}) revoked: ${reason}`);
    this.leases.delete(leaseId);
    this.emit({ type: "counter", name: METRIC_LEASES_REVOKED_TOTAL, labels: { workerId: lease.workerId, role: lease.role, reason } });
    this.emit({ type: "gauge", name: METRIC_LEASES_ACTIVE, value: this.leases.size });
    return true;
  }

  revokeByWorker(workerId: string, reason: string): number {
    let count = 0;
    for (const [id, lease] of this.leases) {
      if (lease.workerId === workerId) {
        this.leases.delete(id);
        count++;
        this.log(`Lease ${id} (${lease.role}) revoked on worker ${workerId}: ${reason}`);
        this.emit({ type: "counter", name: METRIC_LEASES_REVOKED_TOTAL, labels: { workerId, role: lease.role, reason } });
      }
    }
    if (count > 0) {
      this.emit({ type: "gauge", name: METRIC_LEASES_ACTIVE, value: this.leases.size });
    }
    return count;
  }

  getExpired(): Lease[] {
    const now = Date.now();
    return [...this.leases.values()].filter((l) => l.expiresAt <= now);
  }

  hasExpiredLeases(): boolean {
    return this.getExpired().length > 0;
  }

  releaseExpired(): number {
    const expired = this.getExpired();
    for (const l of expired) {
      this.leases.delete(l.leaseId);
      this.log(`Lease ${l.leaseId} (${l.role}) expired`);
      this.emit({ type: "counter", name: METRIC_LEASES_EXPIRED_TOTAL, labels: { workerId: l.workerId, role: l.role } });
    }
    if (expired.length > 0) {
      this.emit({ type: "gauge", name: METRIC_LEASES_ACTIVE, value: this.leases.size });
    }
    return expired.length;
  }

  get(leaseId: string): Lease | undefined {
    return this.leases.get(leaseId);
  }

  getByWorker(workerId: string): Lease[] {
    return [...this.leases.values()].filter((l) => l.workerId === workerId);
  }

  getAll(): Lease[] {
    return [...this.leases.values()];
  }

  activeLeaseCount(): number {
    return this.leases.size;
  }
}
