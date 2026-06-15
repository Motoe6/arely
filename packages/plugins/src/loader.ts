import type { PluginManifest } from "./manifest.js";
import type { PluginSetup } from "./plugin-api.js";
import { PluginRegistry } from "./registry.js";

export interface LoadedPlugin {
  manifest: PluginManifest;
  setup: PluginSetup;
}

export async function loadPlugin(filePath: string): Promise<LoadedPlugin> {
  const mod = await import(filePath);
  if (!mod.default || typeof mod.default !== "object" || typeof mod.default.setup !== "function") {
    throw new Error(`Plugin at "${filePath}" must export a default object with "manifest" and "setup"`);
  }
  if (!mod.default.manifest || !mod.default.manifest.id) {
    throw new Error(`Plugin at "${filePath}" is missing manifest.id`);
  }
  return {
    manifest: mod.default.manifest as PluginManifest,
    setup: mod.default.setup as PluginSetup,
  };
}

export async function loadPluginsInto(registry: PluginRegistry, paths: string[]): Promise<void> {
  for (const p of paths) {
    const plugin = await loadPlugin(p);
    registry.register(plugin.manifest, plugin.setup);
  }
}
