import type { NodeDefinition } from "../types/node.js"

export const LLMNode: NodeDefinition = {
  type: "llm",
  label: "LLM Call",
  category: "ai",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
    },
  },
  async execute(ctx, input) {
    const { prompt } = input as { prompt: string }
    return { output: `mock:${prompt}` }
  },
}
