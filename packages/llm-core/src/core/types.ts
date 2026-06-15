export type KnownApi =
  | "openai-completions"
  | "anthropic-messages"
  | "ollama"
  | "lmstudio";

export type Api = KnownApi | (string & {});

export type Provider = string;

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type MaybePromise<T> = T | Promise<T>;

export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  signal?: AbortSignal;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
}

export type SimpleStreamOptions = StreamOptions;

export interface TextContent {
  type: "text";
  text: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  redacted?: boolean;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Usage {
  input: number;
  output: number;
  totalTokens: number;
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: Provider;
  model: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface Tool<TParameters = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: TParameters;
}

export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial?: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: Extract<StopReason, "stop" | "length" | "toolUse">; message: AssistantMessage }
  | { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };

export interface AssistantMessageEventStream extends AsyncIterable<AssistantMessageEvent> {
  push(event: AssistantMessageEvent): void;
  end(result?: AssistantMessage): void;
  result(): Promise<AssistantMessage>;
}

export type StreamFunction<
  TApi extends Api = Api,
  TOptions extends StreamOptions = StreamOptions,
> = (
  model: Model<TApi>,
  context: Context,
  options?: TOptions,
) => AssistantMessageEventStream;

export interface Model<TApi extends Api = Api> {
  id: string;
  name: string;
  api: TApi;
  provider: Provider;
  baseUrl: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: {
    input: number;
    output: number;
  };
  contextWindow: number;
  maxTokens: number;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export type StreamFn = (
  model: Model,
  context: Context,
  options?: StreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;
