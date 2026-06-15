import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ModelRegistry } from "@arely/engine/models/model-registry.js";
import { ModelAwareAdapter } from "@arely/engine/models/model-adapter.js";

vi.mock("@arely/engine/config/index.js", () => ({
  loadConfig: vi.fn(),
  getConfig: () => ({
    ARELY_API_KEY: "sk-test",
    ARELY_TOOL_MODE: "native",
    ARELY_MODEL: "deepseek-v4",
    ARELY_PERMIT_WEBSEARCH: "allow",
    ARELY_PERMIT_WEBFETCH: "allow",
    CIRCUIT_BREAKER_ENABLED: false,
    RETRY_ENABLED: false,
    RATE_LIMIT_ENABLED: false,
    ARELY_MAX_ITERATIONS: 10,
    ARELY_STREAMING: true,
  }),
}));

describe("Model Session Integration", () => {
  let registry: ModelRegistry;
  let adapter: ModelAwareAdapter;

  beforeEach(() => {
    vi.restoreAllMocks();
    registry = new ModelRegistry();
    adapter = new ModelAwareAdapter(registry, "sk-test");
  });

  it("registry returns 3 default models", () => {
    const models = registry.getAll();
    expect(models).toHaveLength(3);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("deepseek-v4");
    expect(ids).toContain("mimo-v2");
    expect(ids).toContain("nemotron-ultra");
  });

  it("registry returns model by id", () => {
    const model = registry.get("deepseek-v4");
    expect(model).toBeDefined();
    expect(model!.provider).toBe("openrouter");
  });

  it("default model is deepseek-v4", () => {
    expect(registry.getDefaultId()).toBe("deepseek-v4");
  });

  it("adapter uses default model when no model specified", () => {
    const def = registry.getDefault();
    expect(def.id).toBe("deepseek-v4");
  });

  it("getEnabled only returns enabled models", () => {
    const customJson = JSON.stringify([
      { id: "a", name: "A", provider: "test", model: "test/a", baseUrl: "https://test.com", capabilities: ["chat"], contextWindow: 1000, costTier: "free", enabled: true },
      { id: "b", name: "B", provider: "test", model: "test/b", baseUrl: "https://test.com", capabilities: ["chat"], contextWindow: 1000, costTier: "free", enabled: false },
    ]);
    const r = new ModelRegistry(customJson, "a");
    expect(r.getEnabled()).toHaveLength(1);
  });

  it("custom model JSON overrides defaults", () => {
    const customJson = JSON.stringify([
      { id: "custom", name: "Custom Model", provider: "test", model: "custom/model", baseUrl: "https://custom.com/api/v1", capabilities: ["chat", "coding"], contextWindow: 64000, costTier: "free", enabled: true },
    ]);
    const r = new ModelRegistry(customJson, "custom");
    expect(r.getAll()).toHaveLength(1);
    const m = r.get("custom");
    expect(m!.baseUrl).toBe("https://custom.com/api/v1");
    expect(m!.capabilities).toContain("coding");
  });
});
