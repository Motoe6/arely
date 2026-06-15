import type { Model, Context, StreamOptions, AssistantMessage } from "./core/types.js";
import { AssistantMessageEventStreamImpl } from "./core/event-stream.js";
import type { CostTracker } from "./cost-tracker.js";
import { getModelEntry } from "./model-catalog.js";
import { withRetry, type RetryOptions } from "./retry-provider.js";

export interface ProviderEndpoint {
  name: string;
  api: string;
  streamFn: (
    model: Model,
    context: Context,
    options?: StreamOptions,
  ) => AsyncGenerator<any, AssistantMessage, unknown>;
}

export interface FallbackChain {
  providers: ProviderEndpoint[];
  retry?: Partial<RetryOptions>;
}

export class MultiProvider {
  private endpoints = new Map<string, ProviderEndpoint>();
  private fallbackChains = new Map<string, FallbackChain>();
  private defaultChain: FallbackChain | null = null;
  private costTracker: CostTracker | null = null;
  private activeProvider: string | null = null;

  setCostTracker(tracker: CostTracker): void {
    this.costTracker = tracker;
  }

  registerEndpoint(endpoint: ProviderEndpoint): void {
    this.endpoints.set(endpoint.name, endpoint);
  }

  registerFallbackChain(id: string, chain: FallbackChain): void {
    this.fallbackChains.set(id, chain);
  }

  setDefaultChain(chain: FallbackChain): void {
    this.defaultChain = chain;
  }

  getActiveProvider(): string | null {
    return this.activeProvider;
  }

  async complete(
    model: Model,
    context: Context,
    options?: StreamOptions,
    chainId?: string,
  ): Promise<AssistantMessage> {
    const chain = chainId
      ? this.fallbackChains.get(chainId)
      : this.defaultChain;

    if (!chain || chain.providers.length === 0) {
      return {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { input: 0, output: 0, totalTokens: 0 },
        stopReason: "error",
        errorMessage: "No fallback chain configured",
        timestamp: Date.now(),
      };
    }

    let lastError: string | null = null;

    for (const endpoint of chain.providers) {
      this.activeProvider = endpoint.name;

      try {
        const streamFn = withRetry(endpoint.streamFn as any, chain.retry);

        if (options?.signal?.aborted) throw new Error("Aborted by signal");

        const stream = streamFn(model, context, {
          ...options,
          apiKey: options?.apiKey,
        }) as AsyncGenerator<any, AssistantMessage, unknown>;

        let finalMessage: AssistantMessage | null = null;
        for await (const chunk of stream) {
          if (chunk.type === "done") {
            finalMessage = chunk.message;
          }
          if (chunk.type === "error") {
            throw new Error(chunk.error?.errorMessage ?? `Fallback trigger: error`);
          }
        }

        if (finalMessage) {
          this.trackCost(model.id, finalMessage, endpoint.name);
          return finalMessage;
        }

        lastError = "Empty response";
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        this.activeProvider = null;
      }
    }

    this.activeProvider = null;
    return {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { input: 0, output: 0, totalTokens: 0 },
      stopReason: "error",
      errorMessage: `All providers failed. Last error: ${lastError ?? "unknown"}`,
      timestamp: Date.now(),
    };
  }

  private trackCost(modelId: string, msg: AssistantMessage, label?: string): void {
    if (!this.costTracker) return;
    this.costTracker.track(
      modelId,
      msg.usage.input,
      msg.usage.output,
      label,
    );
  }
}
