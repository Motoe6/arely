export const PLUGIN_CAPABILITIES = [
  "tool",
  "memory-extractor",
  "strategy",
  "predictor",
  "evolution-rule",
  "provider",
  "ui",
] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export function isValidCapability(c: string): c is PluginCapability {
  return (PLUGIN_CAPABILITIES as readonly string[]).includes(c);
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  capabilities?: PluginCapability[];
  entry?: string;
  dependencies?: string[];
}
