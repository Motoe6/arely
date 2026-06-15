import { describe, it, expect } from "vitest";
import { ModelRegistry, DEFAULT_MODELS } from "@arelyos/engine/models/model-registry.js";

describe("ModelRegistry", () => {
  it("loads default models when no config provided", () => {
    const registry = new ModelRegistry();
    const all = registry.getAll();
    expect(all).toHaveLength(3);
  });

  it("returns model by id", () => {
    const registry = new ModelRegistry();
    const model = registry.get("deepseek-v4");
    expect(model).toBeDefined();
    expect(model!.name).toBe("DeepSeek V4 Flash Free");
    expect(model!.capabilities).toContain("coding");
    expect(model!.costTier).toBe("free");
  });

  it("returns default model", () => {
    const registry = new ModelRegistry();
    const def = registry.getDefault();
    expect(def.id).toBe("deepseek-v4");
  });

  it("accepts custom default model id", () => {
    const json = JSON.stringify([...DEFAULT_MODELS]);
    const registry = new ModelRegistry(json, "mimo-v2");
    expect(registry.getDefaultId()).toBe("mimo-v2");
  });

  it("filters by capability", () => {
    const registry = new ModelRegistry();
    const coding = registry.getByCapability("coding");
    expect(coding.length).toBeGreaterThanOrEqual(2);
    for (const m of coding) {
      expect(m.capabilities).toContain("coding");
    }
  });

  it("returns only enabled models", () => {
    const json = JSON.stringify([
      { id: "m1", name: "M1", provider: "test", model: "test/m1", baseUrl: "https://test.com", capabilities: ["chat"], contextWindow: 1000, costTier: "free", enabled: true },
      { id: "m2", name: "M2", provider: "test", model: "test/m2", baseUrl: "https://test.com", capabilities: ["chat"], contextWindow: 1000, costTier: "free", enabled: false },
    ]);
    const registry = new ModelRegistry(json, "m1");
    const enabled = registry.getEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].id).toBe("m1");
  });

  it("throws on duplicate ids", () => {
    const json = JSON.stringify([
      { id: "dup", name: "A", provider: "test", model: "test/a", baseUrl: "https://test.com", capabilities: ["chat"], contextWindow: 1000, costTier: "free", enabled: true },
      { id: "dup", name: "B", provider: "test", model: "test/b", baseUrl: "https://test.com", capabilities: ["chat"], contextWindow: 1000, costTier: "free", enabled: true },
    ]);
    expect(() => new ModelRegistry(json)).toThrow("Duplicate model ID");
  });

  it("throws on invalid JSON", () => {
    expect(() => new ModelRegistry("not json")).toThrow();
  });

  it("throws when model missing required fields", () => {
    expect(() => new ModelRegistry(JSON.stringify([{ id: "x" }]))).toThrow("Each model must have id, model, and baseUrl");
  });

  it("falls back to first model if default not found", () => {
    const registry = new ModelRegistry(undefined, "nonexistent");
    expect(registry.getDefaultId()).toBe("deepseek-v4");
  });

  it("custom models override defaults", () => {
    const json = JSON.stringify([
      { id: "custom", name: "Custom", provider: "test", model: "test/custom", baseUrl: "https://test.com", capabilities: ["chat"], contextWindow: 1000, costTier: "free", enabled: true },
    ]);
    const registry = new ModelRegistry(json, "custom");
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getDefault().id).toBe("custom");
  });
});
