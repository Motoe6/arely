import { describe, it, expect } from "vitest";
import { PluginRegistry, definePlugin } from "@arely/plugins";

describe("PluginRegistry", () => {
  it("registers and enables a plugin", async () => {
    const registry = new PluginRegistry();
    const plugin = definePlugin(
      { id: "test", name: "Test Plugin", version: "1.0.0" },
      () => {},
    );
    registry.register(plugin.manifest, plugin.setup);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].enabled).toBe(false);

    await registry.enable("test");
    expect(registry.isEnabled("test")).toBe(true);
  });

  it("throws on duplicate registration", () => {
    const registry = new PluginRegistry();
    const plugin = definePlugin(
      { id: "dup", name: "Dup", version: "1.0.0" },
      () => {},
    );
    registry.register(plugin.manifest, plugin.setup);
    expect(() => registry.register(plugin.manifest, plugin.setup)).toThrow("already registered");
  });

  it("disables a plugin", async () => {
    const registry = new PluginRegistry();
    const plugin = definePlugin(
      { id: "p1", name: "P1", version: "1.0.0" },
      () => {},
    );
    registry.register(plugin.manifest, plugin.setup);
    await registry.enable("p1");
    expect(registry.isEnabled("p1")).toBe(true);
    registry.disable("p1");
    expect(registry.isEnabled("p1")).toBe(false);
  });

  it("lists all plugins with status", async () => {
    const registry = new PluginRegistry();
    registry.register(
      { id: "a", name: "A", version: "1.0.0", capabilities: ["tool"] },
      () => {},
    );
    registry.register(
      { id: "b", name: "B", version: "2.0.0" },
      () => {},
    );
    await registry.enable("a");
    const list = registry.list();
    expect(list.find((p) => p.id === "a")?.enabled).toBe(true);
    expect(list.find((p) => p.id === "b")?.enabled).toBe(false);
    expect(list.find((p) => p.id === "a")?.capabilities).toEqual(["tool"]);
  });
});
