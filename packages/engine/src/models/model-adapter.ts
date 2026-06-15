import type { LLMAdapter, LLMResponse } from "@arelyos/llm-core";
import type { SessionMessage } from "../types.js";
import { OpenAICompatAdapter } from "../llm/openaicompat.js";
import { ModelRegistry, type ModelDefinition } from "./model-registry.js";
import { getConfig } from "../config/index.js";
import { ModelMetrics } from "./model-metrics.js";

export class ModelAwareAdapter implements LLMAdapter {
  private adapters = new Map<string, OpenAICompatAdapter>();
  private metrics: ModelMetrics;

  constructor(
    private registry: ModelRegistry,
    private globalApiKey?: string,
    metrics?: ModelMetrics,
  ) {
    this.metrics = metrics ?? new ModelMetrics();
  }

  getModelMetrics(): ModelMetrics {
    return this.metrics;
  }

  private getAdapter(modelId: string): { adapter: OpenAICompatAdapter; def: ModelDefinition } {
    const cached = this.adapters.get(modelId);
    if (cached) {
      const def = this.registry.get(modelId);
      return { adapter: cached, def: def! };
    }

    const def = this.registry.get(modelId);
    if (!def) {
      const fallback = this.registry.getDefault();
      return this.getAdapter(fallback.id);
    }

    const cfg = getConfig();
    const apiKey = def.apiKey ?? this.globalApiKey ?? cfg.ARELY_API_KEY ?? "";
    const adapter = new OpenAICompatAdapter(
      def.baseUrl,
      apiKey,
      def.model,
      cfg.ARELY_TOOL_MODE === "text",
    );
    this.adapters.set(modelId, adapter);
    return { adapter, def };
  }

  async *complete(
    messages: SessionMessage[],
    signal?: AbortSignal,
    modelId?: string,
  ): AsyncGenerator<LLMResponse> {
    const targetId = modelId ?? this.registry.getDefaultId();
    const { adapter, def } = this.getAdapter(targetId);

    const requestId = crypto.randomUUID();
    this.metrics.recordRequestStart(targetId, requestId);

    try {
      for await (const response of adapter.complete(messages, signal)) {
        this.metrics.recordRequestEnd(targetId, requestId, true);
        yield { ...response, modelId: targetId };
      }
    } catch (err) {
      this.metrics.recordRequestEnd(targetId, requestId, false, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }
}
