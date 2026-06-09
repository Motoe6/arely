import type { NodeDefinition } from "../types/node.js"

export const HttpNode: NodeDefinition = {
  type: "http",
  label: "HTTP Request",
  category: "action",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      method: { type: "string" },
      body: { type: "object" },
    },
  },
  async execute(ctx, input) {
    const { url, method, body } = input as { url: string; method?: string; body?: Record<string, unknown> }
    const res = await fetch(url, {
      method: method ?? "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    return (await res.json()) as Record<string, unknown>
  },
}
