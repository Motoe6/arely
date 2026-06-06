export interface ExecutionRecord {
  timestamp: number;
  metricsHash: string;
}

export class InMemoryPolicyStore {
  private executions = new Map<string, ExecutionRecord[]>();

  recordExecution(ruleId: string, metricsHash: string): void {
    const records = this.executions.get(ruleId) ?? [];
    records.push({ timestamp: Date.now(), metricsHash });
    this.executions.set(ruleId, records);
  }

  getExecutionCount(ruleId: string, windowMs: number): number {
    const records = this.executions.get(ruleId);
    if (!records) return 0;
    const cutoff = Date.now() - windowMs;
    return records.filter((r) => r.timestamp >= cutoff).length;
  }

  getLastExecutionTime(ruleId: string): number | undefined {
    const records = this.executions.get(ruleId);
    if (!records || records.length === 0) return undefined;
    return records[records.length - 1].timestamp;
  }

  hasExecutedWith(ruleId: string, metricsHash: string): boolean {
    const records = this.executions.get(ruleId);
    if (!records) return false;
    return records.some((r) => r.metricsHash === metricsHash);
  }
}
