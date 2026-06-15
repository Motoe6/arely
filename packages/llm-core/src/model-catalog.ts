import type { Model } from "./core/types.js";

export interface ModelPricing {
  inputPer1K: number;
  outputPer1K: number;
  currency: "USD";
}

export interface ModelEntry {
  id: string;
  provider: string;
  api: string;
  contextWindow: number;
  maxOutput: number;
  pricing: ModelPricing;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsThinking?: boolean;
  family: string;
}

const MODELS: ModelEntry[] = [
  // OpenAI
  { id: "gpt-4o", provider: "openai", api: "openai-completions", contextWindow: 128000, maxOutput: 16384, pricing: { inputPer1K: 0.0025, outputPer1K: 0.01, currency: "USD" }, supportsTools: true, supportsStreaming: true, family: "gpt-4" },
  { id: "gpt-4o-mini", provider: "openai", api: "openai-completions", contextWindow: 128000, maxOutput: 16384, pricing: { inputPer1K: 0.00015, outputPer1K: 0.0006, currency: "USD" }, supportsTools: true, supportsStreaming: true, family: "gpt-4" },
  { id: "o3-mini", provider: "openai", api: "openai-completions", contextWindow: 200000, maxOutput: 100000, pricing: { inputPer1K: 0.0011, outputPer1K: 0.0044, currency: "USD" }, supportsTools: true, supportsStreaming: true, supportsThinking: true, family: "o-series" },
  { id: "o4-mini", provider: "openai", api: "openai-completions", contextWindow: 200000, maxOutput: 100000, pricing: { inputPer1K: 0.0011, outputPer1K: 0.0044, currency: "USD" }, supportsTools: true, supportsStreaming: true, supportsThinking: true, family: "o-series" },
  { id: "gpt-5.4", provider: "openai", api: "openai-completions", contextWindow: 1000000, maxOutput: 32000, pricing: { inputPer1K: 0.0025, outputPer1K: 0.01, currency: "USD" }, supportsTools: true, supportsStreaming: true, supportsThinking: true, family: "gpt-5" },

  // Anthropic
  { id: "claude-sonnet-4-20250514", provider: "anthropic", api: "anthropic-messages", contextWindow: 200000, maxOutput: 8192, pricing: { inputPer1K: 0.003, outputPer1K: 0.015, currency: "USD" }, supportsTools: true, supportsStreaming: true, supportsThinking: true, family: "claude-4" },
  { id: "claude-haiku-3-5", provider: "anthropic", api: "anthropic-messages", contextWindow: 200000, maxOutput: 8192, pricing: { inputPer1K: 0.0008, outputPer1K: 0.004, currency: "USD" }, supportsTools: true, supportsStreaming: true, family: "claude-3" },

  // Groq-hosted open models
  { id: "llama-3.3-70b-versatile", provider: "groq", api: "openai-completions", contextWindow: 128000, maxOutput: 32768, pricing: { inputPer1K: 0.00059, outputPer1K: 0.00079, currency: "USD" }, supportsTools: true, supportsStreaming: true, family: "llama" },
  { id: "deepseek-r1-distill-llama-70b", provider: "groq", api: "openai-completions", contextWindow: 128000, maxOutput: 16384, pricing: { inputPer1K: 0.00075, outputPer1K: 0.00099, currency: "USD" }, supportsTools: false, supportsStreaming: true, supportsThinking: true, family: "deepseek" },

  // Local
  { id: "qwen2.5-coder:7b", provider: "ollama", api: "ollama", contextWindow: 32768, maxOutput: 8192, pricing: { inputPer1K: 0, outputPer1K: 0, currency: "USD" }, supportsTools: true, supportsStreaming: true, family: "qwen" },
  { id: "qwen2.5:32b", provider: "ollama", api: "ollama", contextWindow: 32768, maxOutput: 8192, pricing: { inputPer1K: 0, outputPer1K: 0, currency: "USD" }, supportsTools: true, supportsStreaming: true, family: "qwen" },
];

export function getModelEntry(id: string): ModelEntry | undefined {
  return MODELS.find((m) => m.id === id);
}

export function getModelPricing(id: string): ModelPricing | undefined {
  return MODELS.find((m) => m.id === id)?.pricing;
}

export function estimateCost(inputTokens: number, outputTokens: number, modelId: string): number {
  const pricing = getModelPricing(modelId);
  if (!pricing) return 0;
  return (inputTokens / 1000) * pricing.inputPer1K + (outputTokens / 1000) * pricing.outputPer1K;
}

export function getModelsByFamily(family: string): ModelEntry[] {
  return MODELS.filter((m) => m.family === family);
}

export function getModelsByProvider(provider: string): ModelEntry[] {
  return MODELS.filter((m) => m.provider === provider);
}

export function getModelsSupportingTools(): ModelEntry[] {
  return MODELS.filter((m) => m.supportsTools);
}

export function resolveModel(partialId: string): ModelEntry | undefined {
  return MODELS.find((m) => m.id.toLowerCase().includes(partialId.toLowerCase()));
}
