export interface HealthCheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export type HealthCheckFn = () => HealthCheckResult;

export interface HealthStatus {
  ok: boolean;
  checks: HealthCheckSummary[];
}

export interface HealthCheckSummary {
  name: string;
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export class HealthRegistry {
  private checks: Map<string, HealthCheckFn> = new Map();

  registerCheck(name: string, fn: HealthCheckFn): void {
    this.checks.set(name, fn);
  }

  getStatus(): HealthStatus {
    const checks: HealthCheckSummary[] = [];
    let allOk = true;

    for (const [name, fn] of this.checks) {
      let ok = false;
      let latencyMs: number | undefined;
      let error: string | undefined;

      try {
        const start = Date.now();
        const result = fn();
        latencyMs = result.latencyMs ?? (Date.now() - start);
        ok = result.ok;
        error = result.error;
      } catch (err) {
        ok = false;
        error = err instanceof Error ? err.message : String(err);
      }

      if (!ok) allOk = false;
      checks.push({ name, ok, latencyMs, error });
    }

    return { ok: allOk, checks };
  }
}
