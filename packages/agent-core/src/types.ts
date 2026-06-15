export interface SessionMessage {
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
}

export interface ToolResult {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ToolContext {
  sessionId: string;
  agentId?: string;
  signal?: AbortSignal;
}

export interface Tool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface TypedTool extends Tool {
  parameters: ToolParameter[];
}

interface BaseEvent {
  id: string;
  version: 1;
  timestamp: number;
  correlationId?: string;
}

export type SessionThinkingEvent = BaseEvent & {
  type: "session_thinking";
  sessionId: string;
};

export type AssistantMessageCreatedEvent = BaseEvent & {
  type: "assistant_message_created";
  sessionId: string;
  messageId: string;
  content: string;
};

export type AssistantMessageStreamDeltaEvent = BaseEvent & {
  type: "assistant_message_stream_delta";
  sessionId: string;
  delta: string;
};

export type AssistantMessageCompletedEvent = BaseEvent & {
  type: "assistant_message_completed";
  sessionId: string;
  messageId: string;
  content: string;
};

export type ToolResultReceivedEvent = BaseEvent & {
  type: "tool_result_received";
  sessionId: string;
  toolCallId: string;
  toolName: string;
  result: string;
};

export type AgentLoopCompletedEvent = BaseEvent & {
  type: "agent_loop_completed";
  sessionId: string;
  turns: number;
};

export type AgentLoopFailedEvent = BaseEvent & {
  type: "agent_loop_failed";
  sessionId: string;
  error: string;
  turns: number;
};

export type AgentEvent =
  | SessionThinkingEvent
  | AssistantMessageCreatedEvent
  | AssistantMessageStreamDeltaEvent
  | AssistantMessageCompletedEvent
  | ToolResultReceivedEvent
  | AgentLoopCompletedEvent
  | AgentLoopFailedEvent;

export interface BeforeToolCallContext {
  toolName: string;
  args: unknown;
  sessionId: string;
  turn: number;
}

export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface AfterToolCallContext {
  toolName: string;
  args: unknown;
  result: string;
  isError: boolean;
  sessionId: string;
  turn: number;
}

export interface AfterToolCallResult {
  content?: string;
  isError?: boolean;
}

export interface ExecutionResult {
  content: string;
  turns: number;
}

export interface ExecutionMode {
  readonly name: string;
  run(session: unknown, input: string): Promise<ExecutionResult>;
}
