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

export interface SearchOptions {
  numResults?: number;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, options?: SearchOptions, signal?: AbortSignal): Promise<SearchResultItem[]>;
}

export interface SearchResultItem {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string;
}
