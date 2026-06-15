import type { ModelDefinition } from "../models/model-registry.js";

const OLLAMA_HOST = "http://localhost:11434";

export async function detectOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchOllamaModelDefs(): Promise<ModelDefinition[]> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => ({
      id: m.name.replace(/[:]/g, "-").replace(/[/]/g, "-"),
      name: m.name,
      provider: "ollama",
      model: m.name,
      baseUrl: `${OLLAMA_HOST}/v1`,
      capabilities: ["chat", "coding", "tools"] as ModelDefinition["capabilities"],
      contextWindow: 4096,
      costTier: "free" as const,
      enabled: true,
    }));
  } catch {
    return [];
  }
}
