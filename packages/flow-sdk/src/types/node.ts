export interface NodeDefinition<TInput = unknown, TOutput = unknown> {
  type: string
  label: string
  category: "trigger" | "action" | "logic" | "ai" | "code"
  inputSchema: Record<string, unknown>
  execute(ctx: ExecutionContext, input: TInput): Promise<TOutput>
}

export interface ExecutionContext {
  workflowId: string
  executionId: string
  trigger: unknown
  steps: Record<string, unknown>
  secrets: Record<string, string>
}
