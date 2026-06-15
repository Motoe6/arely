export type { LLMAdapter, LLMResponse } from "./adapter.js";
export type { SessionMessage, ToolCallPart } from "./types.js";
export { createModel, ProviderBridgeAdapter } from "./llm-bridge.js";

export type {
  Api,
  KnownApi,
  Provider,
  Model,
  Context,
  Tool,
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ThinkingContent,
  ImageContent,
  ToolCall,
  Usage,
  StreamFunction,
  StreamOptions,
  SimpleStreamOptions,
  StreamFn,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  StopReason,
  MaybePromise,
  ThinkingLevel,
} from "./core/types.js";

export type { ApiProvider, ApiStreamFunction } from "./core/api-registry.js";
export {
  registerApiProvider,
  getApiProvider,
  getApiProviders,
  unregisterApiProviders,
  clearApiProviders,
} from "./core/api-registry.js";

export { AssistantMessageEventStreamImpl } from "./core/event-stream.js";

export {
  registerBuiltInApiProviders,
  resetApiProviders,
  BUILT_IN_SOURCE_ID,
} from "./providers/register-builtins.js";

export * from "./model-catalog.js";
export { CostTracker, type CostRecord, type CostSummary } from "./cost-tracker.js";
export { MultiProvider, type ProviderEndpoint, type FallbackChain } from "./multi-provider.js";
export { withRetry } from "./retry-provider.js";
