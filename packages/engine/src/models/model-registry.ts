export type ModelCapability = "chat" | "reasoning" | "coding" | "vision" | "tools";
export type CostTier = "free" | "low" | "standard" | "premium";

export interface ModelDefinition {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  capabilities: ModelCapability[];
  contextWindow: number;
  costTier: CostTier;
  enabled: boolean;
  systemPrompt?: string;
}

export const DEFAULT_MODELS: ModelDefinition[] = [
  {
    id: "deepseek-v4",
    name: "DeepSeek V4 Flash Free",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash:free",
    baseUrl: "https://openrouter.ai/api/v1",
    capabilities: ["chat", "reasoning", "coding", "tools"],
    contextWindow: 128_000,
    costTier: "free",
    enabled: true,
  },
  {
    id: "mimo-v2",
    name: "MiMo V2.5 Free",
    provider: "openrouter",
    model: "xiaomi/mimo-v2.5:free",
    baseUrl: "https://openrouter.ai/api/v1",
    capabilities: ["chat", "coding", "tools"],
    contextWindow: 128_000,
    costTier: "free",
    enabled: true,
  },
  {
    id: "nemotron-ultra",
    name: "Nemotron 3 Ultra Free",
    provider: "openrouter",
    model: "nvidia/nemotron-3-ultra-120b:free",
    baseUrl: "https://openrouter.ai/api/v1",
    capabilities: ["chat", "reasoning", "coding", "tools"],
    contextWindow: 1_000_000,
    costTier: "free",
    enabled: true,
  },
];

export const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; defaultModel: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", defaultModel: "deepseek/deepseek-v4-flash:free" },
  ollama: { baseUrl: "http://localhost:11434", defaultModel: "qwen2.5:3b" },
  lmstudio: { baseUrl: "http://localhost:1234/v1", defaultModel: "local-model" },
};

export function buildModelId(provider: string, model: string): string {
  return `${provider}:${model}`;
}

export function buildModelsFromProviders(
  providers: Record<string, { enabled: boolean; apiKey?: string; baseUrl?: string; defaultModel?: string }>,
  envApiKeys: Record<string, string | undefined>,
): ModelDefinition[] {
  const models: ModelDefinition[] = [];

  for (const [provider, cfg] of Object.entries(providers)) {
    if (!cfg.enabled) continue;
    const defaults = PROVIDER_DEFAULTS[provider];
    if (!defaults) continue;

    const baseUrl = cfg.baseUrl ?? defaults.baseUrl;
    const modelName = cfg.defaultModel ?? defaults.defaultModel;
    const apiKey = cfg.apiKey ?? envApiKeys[`${provider.toUpperCase()}_API_KEY`];

    models.push({
      id: buildModelId(provider, modelName),
      name: `${provider.charAt(0).toUpperCase() + provider.slice(1)} — ${modelName}`,
      provider,
      model: modelName,
      baseUrl,
      apiKey,
      capabilities: ["chat", "tools"],
      contextWindow: 128_000,
      costTier: "standard",
      enabled: true,
    });
  }

  return models;
}

export class ModelRegistry {
  private models = new Map<string, ModelDefinition>();
  private defaultId: string;

  constructor(modelsJson?: string, defaultId?: string) {
    this.defaultId = defaultId ?? "deepseek-v4";
    const parsed: ModelDefinition[] = modelsJson
      ? this.parseModelsJson(modelsJson)
      : DEFAULT_MODELS;
    for (const m of parsed) {
      if (this.models.has(m.id)) {
        throw new Error(`Duplicate model ID "${m.id}" in registry`);
      }
      this.models.set(m.id, m);
    }
    if (!this.models.has(this.defaultId)) {
      this.defaultId = this.models.keys().next().value as string;
    }
  }

  private parseModelsJson(json: string): ModelDefinition[] {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      throw new Error("ARELY_MODELS must be a JSON array");
    }
    for (const m of parsed) {
      if (!m.id || !m.model || !m.baseUrl) {
        throw new Error(`Each model must have id, model, and baseUrl`);
      }
    }
    return parsed as ModelDefinition[];
  }

  getAll(): ModelDefinition[] {
    return Array.from(this.models.values());
  }

  get(id: string): ModelDefinition | undefined {
    return this.models.get(id);
  }

  getDefault(): ModelDefinition {
    return this.models.get(this.defaultId) ?? this.getAll()[0];
  }

  getDefaultId(): string {
    return this.defaultId;
  }

  getByCapability(cap: ModelCapability): ModelDefinition[] {
    return this.getAll().filter((m) => m.capabilities.includes(cap) && m.enabled);
  }

  getEnabled(): ModelDefinition[] {
    return this.getAll().filter((m) => m.enabled);
  }
}