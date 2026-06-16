import type { z } from "zod";
import type { envSchema } from "./schema.js";

export type Config = z.infer<typeof envSchema>;

export const KNOWN_PROVIDERS = [
  "openai",
  "anthropic",
  "openrouter",
  "ollama",
  "lmstudio",
  "azure",
] as const;

export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

export interface ProviderConfigFile {
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export interface UserConfigFile {
  defaultProvider?: string;
  defaultModel?: string;
  enabledModels?: string[];
  mode?: "chat" | "agent" | "server";
  baseUrl?: string;
  port?: number;
  swarmEnabled?: boolean;
  goalResumeEnabled?: boolean;
  benchmarksEnabled?: boolean;
  autoRecover?: boolean;
  apiKey?: string;

  /** Multi-provider config (v2) */
  providers?: Partial<Record<KnownProvider, ProviderConfigFile>>;
  swarmProviders?: Record<string, string>;
}
