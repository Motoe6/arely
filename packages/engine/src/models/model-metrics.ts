export interface ModelRunRecord {
  modelId: string;
  requestId: string;
  timestamp: number;
  latencyMs?: number;
  success: boolean;
  error?: string;
}

interface ModelStats {
  requests: number;
  errors: number;
  totalLatencyMs: number;
}

export class ModelMetrics {
  private pending = new Map<string, { modelId: string; startTime: number }>();
  private stats = new Map<string, ModelStats>();

  recordRequestStart(modelId: string, requestId: string): void {
    this.pending.set(requestId, { modelId, startTime: Date.now() });
  }

  recordRequestEnd(modelId: string, requestId: string, success: boolean, error?: string): void {
    const pending = this.pending.get(requestId);
    const latencyMs = pending ? Date.now() - pending.startTime : 0;
    this.pending.delete(requestId);

    let s = this.stats.get(modelId);
    if (!s) {
      s = { requests: 0, errors: 0, totalLatencyMs: 0 };
      this.stats.set(modelId, s);
    }
    s.requests++;
    s.totalLatencyMs += latencyMs;
    if (!success) s.errors++;
  }

  getStats(modelId?: string): { requests: number; avgLatencyMs: number; errorRate: number } | null {
    if (modelId) {
      const s = this.stats.get(modelId);
      if (!s) return null;
      return {
        requests: s.requests,
        avgLatencyMs: s.requests > 0 ? Math.round(s.totalLatencyMs / s.requests) : 0,
        errorRate: s.requests > 0 ? s.errors / s.requests : 0,
      };
    }
    return null;
  }

  getAggregated(): Record<string, { requests: number; avgLatencyMs: number; errorRate: number }> {
    const result: Record<string, { requests: number; avgLatencyMs: number; errorRate: number }> = {};
    for (const [modelId, s] of this.stats) {
      result[modelId] = {
        requests: s.requests,
        avgLatencyMs: s.requests > 0 ? Math.round(s.totalLatencyMs / s.requests) : 0,
        errorRate: s.requests > 0 ? s.errors / s.requests : 0,
      };
    }
    return result;
  }

  reset(): void {
    this.pending.clear();
    this.stats.clear();
  }
}
