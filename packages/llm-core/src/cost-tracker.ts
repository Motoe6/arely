import { estimateCost, getModelEntry } from "./model-catalog.js";

export interface CostRecord {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  timestamp: number;
  label?: string;
}

export interface CostSummary {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  callCount: number;
  byModel: Record<string, { calls: number; cost: number; tokens: number }>;
  byLabel: Record<string, { calls: number; cost: number; tokens: number }>;
}

export class CostTracker {
  private records: CostRecord[] = [];
  private budgetLimit: number | null = null;
  private onBudgetExceeded?: (summary: CostSummary) => void;

  setBudget(limit: number): void {
    this.budgetLimit = limit;
  }

  onExceeded(handler: (summary: CostSummary) => void): void {
    this.onBudgetExceeded = handler;
  }

  track(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    label?: string,
  ): CostRecord {
    const cost = estimateCost(inputTokens, outputTokens, modelId);
    const record: CostRecord = {
      modelId,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cost,
      timestamp: Date.now(),
      label,
    };
    this.records.push(record);

    if (this.budgetLimit !== null) {
      const total = this.getSummary().totalCost;
      if (total > this.budgetLimit) {
        this.onBudgetExceeded?.(this.getSummary());
      }
    }

    return record;
  }

  getSummary(): CostSummary {
    const summary: CostSummary = {
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      callCount: this.records.length,
      byModel: {},
      byLabel: {},
    };

    for (const r of this.records) {
      summary.totalCost += r.cost;
      summary.totalInputTokens += r.inputTokens;
      summary.totalOutputTokens += r.outputTokens;
      summary.totalTokens += r.totalTokens;

      if (!summary.byModel[r.modelId]) {
        summary.byModel[r.modelId] = { calls: 0, cost: 0, tokens: 0 };
      }
      summary.byModel[r.modelId].calls++;
      summary.byModel[r.modelId].cost += r.cost;
      summary.byModel[r.modelId].tokens += r.totalTokens;

      if (r.label) {
        if (!summary.byLabel[r.label]) {
          summary.byLabel[r.label] = { calls: 0, cost: 0, tokens: 0 };
        }
        summary.byLabel[r.label].calls++;
        summary.byLabel[r.label].cost += r.cost;
        summary.byLabel[r.label].tokens += r.totalTokens;
      }
    }

    return summary;
  }

  reset(): void {
    this.records = [];
  }

  getRecords(): CostRecord[] {
    return [...this.records];
  }
}
