import type { LLMAdapter, LLMResponse } from "@arelyos/llm-core";
import type { SessionMessage } from "../types.js";
import { OpenAICompatAdapter } from "../llm/openaicompat.js";
import { ModelRegistry, type ModelDefinition, buildModelId } from "./model-registry.js";
import { getConfig } from "../config/index.js";
import type { KnownProvider } from "../config/types.js";
import { loadUserConfigFile } from "../config/io.js";
import { ModelMetrics } from "./model-metrics.js";

export interface CompleteOptions {
  modelId?: string;
  provider?: string;
  model?: string;
}

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

  private resolveModel(modelId?: string, provider?: string, model?: string): ModelDefinition {
    // Direct model ID lookup first
    if (modelId) {
      let def = this.registry.get(modelId);
      if (def) return def;
      // Parse "provider:model" format and resolve dynamically
      const colonIdx = modelId.indexOf(":");
      if (colonIdx !== -1) {
        return this.resolveModel(undefined, modelId.slice(0, colonIdx), modelId.slice(colonIdx + 1));
      }
    }

    // Resolve by provider + model name
    if (provider) {
      const cfg = getConfig();
      const userConfig = loadUserConfigFile();
      const providerCfg = userConfig.providers?.[provider as KnownProvider];
      const envKey = `${provider.toUpperCase()}_API_KEY`;
      const apiKey = providerCfg?.apiKey ?? process.env[envKey] ?? this.globalApiKey ?? cfg.ARELY_API_KEY;

      if (model) {
        const id = buildModelId(provider, model);
        let def = this.registry.get(id);
        if (!def) {
          const baseUrl = providerCfg?.baseUrl ?? `https://api.${provider}.com/v1`;
          def = {
            id,
            name: `${provider} — ${model}`,
            provider,
            model,
            baseUrl,
            apiKey,
            capabilities: ["chat", "tools"],
            contextWindow: 128_000,
            costTier: "standard",
            enabled: true,
          };
        }
        return def;
      }
    }

    // Fallback to default
    return this.registry.getDefault();
  }

  private getAdapter(targetDef: ModelDefinition): { adapter: OpenAICompatAdapter; def: ModelDefinition } {
    const cached = this.adapters.get(targetDef.id);
    if (cached) {
      return { adapter: cached, def: targetDef };
    }

    const cfg = getConfig();
    const apiKey = targetDef.apiKey ?? this.globalApiKey ?? cfg.ARELY_API_KEY ?? "";
    const adapter = new OpenAICompatAdapter(
      targetDef.baseUrl,
      apiKey,
      targetDef.model,
      cfg.ARELY_TOOL_MODE === "text",
    );
    this.adapters.set(targetDef.id, adapter);
    return { adapter, def: targetDef };
  }

  async *complete(
    messages: SessionMessage[],
    signal?: AbortSignal,
    modelIdOrOpts?: string | CompleteOptions,
  ): AsyncGenerator<LLMResponse> {
    let targetDef: ModelDefinition;

    if (typeof modelIdOrOpts === "string") {
      targetDef = this.resolveModel(modelIdOrOpts);
    } else if (modelIdOrOpts) {
      targetDef = this.resolveModel(modelIdOrOpts.modelId, modelIdOrOpts.provider, modelIdOrOpts.model);
    } else {
      targetDef = this.resolveModel();
    }

    const { adapter, def } = this.getAdapter(targetDef);

    const requestId = crypto.randomUUID();
    this.metrics.recordRequestStart(targetDef.id, requestId);

    try {
      for await (const response of adapter.complete(messages, signal)) {
        this.metrics.recordRequestEnd(targetDef.id, requestId, true);
        yield { ...response, modelId: targetDef.id };
      }
    } catch (err) {
      this.metrics.recordRequestEnd(targetDef.id, requestId, false, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }
}