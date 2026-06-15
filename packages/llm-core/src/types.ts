export interface SessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: ToolCallPart[];
}

export interface ToolCallPart {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  status: string;
  result?: string;
  error?: string;
  metadata?: Record<string, string>;
  startTime?: number;
  endTime?: number;
}
