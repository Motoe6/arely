import type { Model, Context, AssistantMessage, StreamOptions, StreamFunction } from "./core/types.js";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: true,
};

const NON_RETRYABLE_STATUSES = [400, 401, 403, 422, 429];

function isRetryable(err: unknown): boolean {
  if (err instanceof Error && "statusCode" in err) {
    const code = (err as any).statusCode;
    return !NON_RETRYABLE_STATUSES.includes(code);
  }
  if (err instanceof Error && err.message.includes("401")) return false;
  if (err instanceof Error && err.message.includes("403")) return false;
  if (err instanceof Error && err.message.includes("invalid")) return false;
  return true;
}

function getDelay(attempt: number, opts: RetryOptions): number {
  const delay = Math.min(opts.baseDelayMs * Math.pow(2, attempt - 1), opts.maxDelayMs);
  if (opts.jitter) {
    return delay * (0.5 + Math.random() * 0.5);
  }
  return delay;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withRetry<T extends StreamFunction<string, StreamOptions>>(
  fn: T,
  retryOpts?: Partial<RetryOptions>,
): T {
  const opts = { ...DEFAULT_RETRY, ...retryOpts };

  return ((model: Model, context: Context, options?: StreamOptions) => {
    const wrapper = async (): Promise<AssistantMessage> => {
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        try {
          if (options?.signal?.aborted) throw new Error("Aborted");

          const innerProvider = fn as any;
          const result = await innerProvider(model, context, options);

          if (result && typeof result === "object" && Symbol.asyncIterator in result) {
            let finalMessage: AssistantMessage | null = null;
            for await (const chunk of result) {
              if (chunk.type === "done") {
                finalMessage = chunk.message;
              }
              if (chunk.type === "error") {
                throw new Error(chunk.error?.errorMessage ?? "Provider error");
              }
            }
            if (finalMessage) return finalMessage;
            throw new Error("No response from provider");
          }

          return result as unknown as AssistantMessage;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));

          if (!isRetryable(lastError)) throw lastError;
          if (attempt === opts.maxAttempts) throw lastError;

          const delay = getDelay(attempt, opts);
          await sleep(delay);
        }
      }

      throw lastError ?? new Error("Max retries exceeded");
    };

    const stream = new (require("./core/event-stream.js").AssistantMessageEventStreamImpl)();
    wrapper()
      .then((msg) => {
        stream.push({ type: "done", reason: "stop", message: msg });
        stream.end(msg);
      })
      .catch((err) => {
        stream.push({
          type: "error",
          reason: "error",
          error: {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: { input: 0, output: 0, totalTokens: 0 },
            stopReason: "error",
            errorMessage: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          },
        });
        stream.end();
      });

    return stream;
  }) as T;
}
