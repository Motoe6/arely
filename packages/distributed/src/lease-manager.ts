import type { Lease, CoordinatorConfig } from "./types.js";
import { newLeaseId } from "./types.js";

export class LeaseManager {
  private leases = new Map<string, Lease>();
  private config: CoordinatorConfig;
  private log: (msg: string) => void;

  constructor(config: CoordinatorConfig, log?: (msg: string) => void) {
    this.config = config;
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
    return lease;
  }

  renew(leaseId: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease) return false;
    lease.renewedAt = Date.now();
    lease.expiresAt = Date.now() + this.config.leaseDurationMs;
    lease.attempt++;
    return true;
  }

  revoke(leaseId: string, reason: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease) return false;
    this.log(`Lease ${leaseId} (${lease.role} on ${lease.workerId}) revoked: ${reason}`);
    this.leases.delete(leaseId);
    return true;
  }

  revokeByWorker(workerId: string, reason: string): number {
    let count = 0;
    for (const [id, lease] of this.leases) {
      if (lease.workerId === workerId) {
        this.leases.delete(id);
        count++;
        this.log(`Lease ${id} (${lease.role}) revoked on worker ${workerId}: ${reason}`);
      }
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
