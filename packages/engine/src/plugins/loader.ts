import type { PluginManifest } from "./manifest.js";

export interface LoadedPlugin {
  manifest: PluginManifest;
  exports: Record<string, unknown>;
}

const loadedPlugins = new Map<string, LoadedPlugin>();

export async function loadPlugin(manifestPath: string): Promise<LoadedPlugin> {
  const manifest: PluginManifest = await import(manifestPath, { with: { type: "json" } }).then(
    (m) => m.default as PluginManifest,
  );
  if (loadedPlugins.has(manifest.id)) {
    throw new Error(`Plugin "${manifest.id}" already loaded`);
  }
  const exports = await import(manifest.entry);
  const plugin: LoadedPlugin = { manifest, exports };
  loadedPlugins.set(manifest.id, plugin);
  return plugin;
}

export function getPlugin(id: string): LoadedPlugin | undefined {
  return loadedPlugins.get(id);
}

export function listPlugins(): LoadedPlugin[] {
  return Array.from(loadedPlugins.values());
}

export function unloadPlugin(id: string): void {
  loadedPlugins.delete(id);
}

export function findPluginsByCapability(kind: string, name?: string): LoadedPlugin[] {
  return Array.from(loadedPlugins.values()).filter((p) =>
    p.manifest.capabilities?.some(
      (c) => c.kind === kind && (!name || ("name" in c && c.name === name)),
    ),
  );
}
