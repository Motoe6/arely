import { describe, it, expect, vi } from "vitest";
import { PluginRegistry, definePlugin, type ArelyPluginHooks } from "@arely/plugins";

describe("Plugin Hooks", () => {
  it("collects hooks from multiple enabled plugins", async () => {
    const registry = new PluginRegistry();

    const hook1 = vi.fn();
    const hook2 = vi.fn();

    const p1 = definePlugin({ id: "p1", name: "P1", version: "1.0.0" }, (ctx) => {
      ctx.hooks.afterToolCall = hook1;
    });
    const p2 = definePlugin({ id: "p2", name: "P2", version: "1.0.0" }, (ctx) => {
      ctx.hooks.afterToolCall = hook2;
    });

    registry.register(p1.manifest, p1.setup);
    registry.register(p2.manifest, p2.setup);
    await registry.enable("p1");
    await registry.enable("p2");

    const hooks = registry.getHooks();
    await hooks.afterToolCall!({ toolName: "test", args: {}, result: "ok", sessionId: "s1" });
    expect(hook1).toHaveBeenCalled();
    expect(hook2).toHaveBeenCalled();
  });

  it("beforeToolCall can block execution", async () => {
    const registry = new PluginRegistry();
    const p = definePlugin({ id: "guard", name: "Guard", version: "1.0.0" }, (ctx) => {
      ctx.hooks.beforeToolCall = async () => ({ block: true, reason: "Not allowed" });
    });
    registry.register(p.manifest, p.setup);
    await registry.enable("guard");

    const hooks = registry.getHooks();
    const result = await hooks.beforeToolCall!({ toolName: "danger", args: {}, sessionId: "s1" });
    expect(result).toEqual({ block: true, reason: "Not allowed" });
  });

  it("disabling a plugin removes its hooks", async () => {
    const registry = new PluginRegistry();
    const hook = vi.fn();
    const p = definePlugin({ id: "p1", name: "P1", version: "1.0.0" }, (ctx) => {
      ctx.hooks.afterToolCall = hook;
    });
    registry.register(p.manifest, p.setup);
    await registry.enable("p1");
    registry.disable("p1");

    const hooks = registry.getHooks();
    expect(hooks.afterToolCall).toBeUndefined();
  });

  it("provides all hook lifecycle methods", async () => {
    const registry = new PluginRegistry();
    const p = definePlugin({ id: "full", name: "Full", version: "1.0.0" }, (ctx) => {
      ctx.hooks.beforeToolCall = async () => {};
      ctx.hooks.afterToolCall = async () => {};
      ctx.hooks.beforeMemoryStore = async () => {};
      ctx.hooks.afterMemoryStore = async () => {};
      ctx.hooks.beforeDecision = async () => {};
      ctx.hooks.afterDecision = async () => {};
      ctx.hooks.beforeStrategySelection = async () => {};
      ctx.hooks.afterStrategySelection = async () => {};
      ctx.hooks.beforePrediction = async () => {};
      ctx.hooks.afterPrediction = async () => {};
    });
    registry.register(p.manifest, p.setup);
    await registry.enable("full");

    const hooks = registry.getHooks();
    expect(hooks.beforeToolCall).toBeDefined();
    expect(hooks.afterToolCall).toBeDefined();
    expect(hooks.beforeMemoryStore).toBeDefined();
    expect(hooks.afterMemoryStore).toBeDefined();
    expect(hooks.beforeDecision).toBeDefined();
    expect(hooks.afterDecision).toBeDefined();
    expect(hooks.beforeStrategySelection).toBeDefined();
    expect(hooks.afterStrategySelection).toBeDefined();
    expect(hooks.beforePrediction).toBeDefined();
    expect(hooks.afterPrediction).toBeDefined();
  });
});
