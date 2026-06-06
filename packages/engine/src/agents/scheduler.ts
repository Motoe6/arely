import { listAgents } from "./agent-store.js";
import { executeAgent, type RuntimeConfig } from "./runtime.js";
import { executePipeline } from "./pipeline.js";
import { parseIntervalConfig, isTriggerDue } from "./triggers/interval.js";
import { listPlansByAgent } from "../persistence/plan-store.js";
import { logger } from "../logger.js";
import type { ExecutionTracer } from "./execution-tracer.js";

export class AgentScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private runningAgents = new Set<string>();
  private config: RuntimeConfig;
  private intervalMs: number;
  private tracer: ExecutionTracer | undefined;

  constructor(config: RuntimeConfig, intervalMs: number, tracer?: ExecutionTracer) {
    this.config = config;
    this.intervalMs = intervalMs;
    this.tracer = tracer;
  }

  start(): void {
    if (this.timer) return;
    logger.info("scheduler", "Agent scheduler started", { metadata: { intervalMs: this.intervalMs } });
    this.tick();
    this.timer = setInterval(() => { this.tick(); }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info("scheduler", "Agent scheduler stopped");
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  private tick(): void {
    const agents = listAgents(true);
    for (const agent of agents) {
      if (this.runningAgents.has(agent.id)) continue;

      if (agent.trigger === "interval") {
        const cfg = parseIntervalConfig(agent.triggerConfig);
        if (!cfg) continue;

        const plans = listPlansByAgent(agent.id);
        const lastPlan = plans.length > 0 ? plans[plans.length - 1] : null;
        const lastRunAt = lastPlan ? new Date(lastPlan.createdAt).getTime() : null;

        if (!isTriggerDue(cfg.intervalMs, lastRunAt)) continue;
      }

      if (agent.trigger === "pipeline") {
        const cfg = tryParsePipelineConfig(agent.triggerConfig);
        if (!cfg?.pipelineId) {
          logger.warn("scheduler", `Agent ${agent.id} has pipeline trigger but no pipelineId in config`);
          continue;
        }

        this.runningAgents.add(agent.id);
        void executePipeline(cfg.pipelineId, this.config, this.tracer).finally(() => {
          this.runningAgents.delete(agent.id);
        });
        continue;
      }

      this.runningAgents.add(agent.id);
      void executeAgent(agent.id, this.config).finally(() => {
        this.runningAgents.delete(agent.id);
      });
    }
  }
}

function tryParsePipelineConfig(config: string | null): { pipelineId?: string; intervalMs?: number } | null {
  if (!config) return null;
  try {
    return JSON.parse(config) as { pipelineId?: string; intervalMs?: number };
  } catch {
    return null;
  }
}
