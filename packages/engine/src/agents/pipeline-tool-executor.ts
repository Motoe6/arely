import { CircuitBreakerOpenError } from "../tools/errors.js";
import { withTimeoutSignal } from "../tools/errors.js";
import { classifyExecutionError } from "./error-classifier.js";
import type { PipelineCircuitBreakerRegistry } from "./circuit-breaker-registry.js";

export class PipelineToolError extends Error {}

interface ToolSandboxConfig {
  timeoutMs: number;
  allowlist?: string[];
}

export class PipelineToolExecutor {
  constructor(
    private handlers: Map<string, (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>,
    private config: ToolSandboxConfig,
    private breakerRegistry?: PipelineCircuitBreakerRegistry,
  ) {}

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    ctx?: { stepId?: string; pipelineId?: string; signal?: AbortSignal },
  ): Promise<{ content: string; raw?: unknown }> {
    if (this.config.allowlist && !this.config.allowlist.includes(toolName)) {
      throw new PipelineToolError(`Tool '${toolName}' not in pipeline allowlist`);
    }
    const handler = this.handlers.get(toolName);
    if (!handler) throw new PipelineToolError(`Unknown tool: ${toolName}`);

    const exec = async (): Promise<{ content: string; raw?: unknown }> => {
      const res = await withTimeoutSignal((signal) => handler(args, signal), this.config.timeoutMs, ctx?.signal);
      const content = typeof res === "string" ? res : JSON.stringify(res);
      return { content, raw: res };
    };

    if (this.breakerRegistry) {
      try {
        return await this.breakerRegistry.execute(toolName, null, exec);
      } catch (err) {
        if (err instanceof CircuitBreakerOpenError) {
          throw new PipelineToolError(`Tool '${toolName}' is currently blocked by circuit breaker: ${err.message}`);
        }
        throw err;
      }
    }

    return exec();
  }
}
