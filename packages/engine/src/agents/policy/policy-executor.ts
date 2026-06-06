import { createHash } from "node:crypto";
import type { PolicyAction } from "./policy-types.js";
import type { PolicyActionHandlers, PolicyExecutionResult, PolicyExecutorConfig } from "./policy-execution-types.js";
import type { Tracer } from "../../tracer.js";

const DEFAULT_CONFIG: PolicyExecutorConfig = {
  handlerTimeoutMs: 5000,
};

export class PolicyExecutor {
  private handlers: PolicyActionHandlers;
  private config: PolicyExecutorConfig;
  private executed = new Map<string, "success" | "failed">();
  private tracer: Tracer | undefined;

  constructor(handlers: PolicyActionHandlers, config?: Partial<PolicyExecutorConfig>) {
    this.handlers = handlers;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tracer = config?.tracer;
  }

  clearExecuted(): void {
    this.executed.clear();
  }

  async execute(actions: PolicyAction[], trace?: { traceId: string }): Promise<PolicyExecutionResult[]> {
    let execSpan: ReturnType<NonNullable<typeof this.tracer>["startSpan"]> | undefined;

    if (this.tracer && trace) {
      execSpan = this.tracer.startSpan(trace.traceId, "policy.execute");
    }

    const results: PolicyExecutionResult[] = [];
    for (const action of actions) {
      const result = await this.executeSingle(action, trace);
      results.push(result);
    }

    if (this.tracer && execSpan) {
      const matched = results.filter(r => r.status === "success").length;
      const failed = results.filter(r => r.status === "failed").length;
      const skipped = results.filter(r => r.status === "skipped").length;
      this.tracer.endSpan(execSpan, { actionCount: actions.length, matched, failed, skipped });
    }

    return results;
  }

  private async executeSingle(action: PolicyAction, trace?: { traceId: string }): Promise<PolicyExecutionResult> {
    const executionKey = this.createExecutionKey(action);
    const startedAt = Date.now();
    let handlerSpan: ReturnType<NonNullable<typeof this.tracer>["startSpan"]> | undefined;

    if (this.tracer && trace) {
      handlerSpan = this.tracer.startSpan(trace.traceId, "handler.run");
    }

    if (this.executed.has(executionKey)) {
      if (this.tracer && handlerSpan) {
        this.tracer.endSpan(handlerSpan, { action: action.action, ruleId: action.ruleId, status: "skipped" });
      }
      return {
        action,
        status: "skipped",
        startedAt,
        finishedAt: Date.now(),
        error: "duplicate execution (idempotency)",
      };
    }

    const handler = this.handlers[action.action];
    if (!handler) {
      this.executed.set(executionKey, "failed");
      if (this.tracer && handlerSpan) {
        this.tracer.endSpan(handlerSpan, { action: action.action, ruleId: action.ruleId, status: "failed" }, "no handler registered");
      }
      return {
        action,
        status: "failed",
        startedAt,
        finishedAt: Date.now(),
        error: `no handler registered for action type: ${action.action}`,
      };
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`handler timed out after ${this.config.handlerTimeoutMs}ms`)),
          this.config.handlerTimeoutMs,
        );
      });
      await Promise.race([handler(action.payload), timeoutPromise]);
      clearTimeout(timeoutId);
      this.executed.set(executionKey, "success");
      if (this.tracer && handlerSpan) {
        this.tracer.endSpan(handlerSpan, { action: action.action, ruleId: action.ruleId, status: "success" });
      }
      return { action, status: "success", startedAt, finishedAt: Date.now() };
    } catch (err) {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      this.executed.set(executionKey, "failed");
      if (this.tracer && handlerSpan) {
        this.tracer.endSpan(handlerSpan, { action: action.action, ruleId: action.ruleId, status: "failed" }, err instanceof Error ? err.message : String(err));
      }
      return {
        action,
        status: "failed",
        startedAt,
        finishedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private createExecutionKey(action: PolicyAction): string {
    return createHash("sha256")
      .update(`${action.ruleId}:${action.action}:${action.timestamp}`)
      .digest("hex");
  }
}
