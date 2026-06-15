import { registerApiProvider, unregisterApiProviders } from "../core/api-registry.js";
import { streamOpenAICompletions, streamSimpleOpenAICompletions } from "./openai-completions.js";
import { streamAnthropic } from "./anthropic.js";
import { streamOllama } from "./ollama.js";
import type { SimpleStreamOptions, StreamFunction, StreamOptions } from "../core/types.js";

export const BUILT_IN_SOURCE_ID = "arely:built-in";

const simpleOpenAI: StreamFunction<"openai-completions", SimpleStreamOptions> = streamSimpleOpenAICompletions;
const simpleAnthropic: StreamFunction<"anthropic-messages", SimpleStreamOptions> = streamAnthropic;
const simpleOllama: StreamFunction<"ollama", SimpleStreamOptions> = streamOllama;

export function registerBuiltInApiProviders(): void {
  registerApiProvider(
    { api: "openai-completions", stream: streamOpenAICompletions },
    BUILT_IN_SOURCE_ID,
  );
  registerApiProvider(
    { api: "anthropic-messages", stream: streamAnthropic },
    BUILT_IN_SOURCE_ID,
  );
  registerApiProvider(
    { api: "ollama", stream: streamOllama },
    BUILT_IN_SOURCE_ID,
  );
}

export function resetApiProviders(): void {
  unregisterApiProviders(BUILT_IN_SOURCE_ID);
  registerBuiltInApiProviders();
}
