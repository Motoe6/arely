export const SDK_DEFAULTS = {
  provider: "ollama",
  model: "deepseek-r1",
  maxIterations: 20,
  memoryEnabled: true,
  dbPath: "",
} as const;

export interface ArelyConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  maxIterations: number;
  memoryEnabled: boolean;
  dbPath?: string;
  tools?: ArelyTool[];
}

export interface ArelyTool {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function resolveConfig(input: DeepPartial<ArelyConfig> = {}): ArelyConfig {
  return { ...SDK_DEFAULTS, ...input } as ArelyConfig;
}

export function getEnvConfig(): DeepPartial<ArelyConfig> {
  return {
    provider: process.env["ARELY_PROVIDER"],
    model: process.env["ARELY_MODEL"],
    baseUrl: process.env["ARELY_BASE_URL"],
    apiKey: process.env["ARELY_API_KEY"],
    dbPath: process.env["ARELY_DB_PATH"],
  };
}
