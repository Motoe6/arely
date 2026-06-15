import { describe, it, expect } from "vitest";
import { PluginRegistry, definePlugin } from "@arelyos/plugins";

describe("Plugin Capabilities", () => {
  it("plugin registers a tool via setup context", async () => {
    const registry = new PluginRegistry();
    const plugin = definePlugin(
      { id: "tool-plugin", name: "Tool Plugin", version: "1.0.0", capabilities: ["tool"] },
      (ctx) => {
        ctx.registerTool("hello", "Says hello", async () => "Hello world");
      },
    );
    registry.register(plugin.manifest, plugin.setup);
    await registry.enable("tool-plugin");
    const caps = registry.getCapabilityRegistry();
    expect(caps.tools.has("hello")).toBe(true);
    expect(caps.tools.get("hello")?.description).toBe("Says hello");
    const result = await caps.tools.get("hello")!.execute({});
    expect(result).toBe("Hello world");
  });

  it("plugin registers a predictor", async () => {
    const registry = new PluginRegistry();
    const plugin = definePlugin(
      { id: "pred-plugin", name: "Predictor", version: "1.0.0", capabilities: ["predictor"] },
      (ctx) => {
        ctx.registerPredictor({
          id: "success-forecast",
          async predict() {
            return { successProbability: 0.84, confidence: 0.72 };
          },
        });
      },
    );
    registry.register(plugin.manifest, plugin.setup);
    await registry.enable("pred-plugin");
    const caps = registry.getCapabilityRegistry();
    expect(caps.predictors.has("success-forecast")).toBe(true);
    const result = await caps.predictors.get("success-forecast")!.predict({
      decisionType: "test",
      context: {},
      history: [],
    });
    expect(result.successProbability).toBe(0.84);
    expect(result.confidence).toBe(0.72);
  });

  it("plugin registers a strategy", async () => {
    const registry = new PluginRegistry();
    const plugin = definePlugin(
      { id: "strat-plugin", name: "Strategy", version: "1.0.0", capabilities: ["strategy"] },
      (ctx) => {
        ctx.registerStrategy({
          id: "best-effort",
          name: "Best Effort",
          async select(ctx) {
            return { recommendedAction: ctx.availableActions[0], reasoning: "default" };
          },
        });
      },
    );
    registry.register(plugin.manifest, plugin.setup);
    await registry.enable("strat-plugin");
    const caps = registry.getCapabilityRegistry();
    expect(caps.strategies.has("best-effort")).toBe(true);
  });

  it("plugin registers a memory extractor", async () => {
    const registry = new PluginRegistry();
    const plugin = definePlugin(
      { id: "mem-plugin", name: "Memory", version: "1.0.0", capabilities: ["memory-extractor"] },
      (ctx) => {
        ctx.registerMemoryExtractor({
          id: "fact-extractor",
          async extract(input) {
            return { memories: [{ key: "fact", value: input.content, type: "knowledge", confidence: 80 }] };
          },
        });
      },
    );
    registry.register(plugin.manifest, plugin.setup);
    await registry.enable("mem-plugin");
    const caps = registry.getCapabilityRegistry();
    expect(caps.memoryExtractors.has("fact-extractor")).toBe(true);
  });

  it("plugin registers an evolution rule", async () => {
    const registry = new PluginRegistry();
    const plugin = definePlugin(
      { id: "evo-plugin", name: "Evolution", version: "1.0.0", capabilities: ["evolution-rule"] },
      (ctx) => {
        ctx.registerEvolutionRule({
          id: "perf-rule",
          async evaluate() {
            return { shouldEvolve: false, suggestions: [] };
          },
        });
      },
    );
    registry.register(plugin.manifest, plugin.setup);
    await registry.enable("evo-plugin");
    const caps = registry.getCapabilityRegistry();
    expect(caps.evolutionRules.has("perf-rule")).toBe(true);
  });
});
