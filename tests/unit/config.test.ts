import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should load valid configuration", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "sk-test-key");
    vi.stubEnv("OPENCODE_MODEL", "gpt-4o");

    const { loadConfig } = await import("@opencode/engine/config/index.js");
    const config = loadConfig();

    expect(config).toBeDefined();
    expect(config.OPENCODE_API_KEY).toBe("sk-test-key");
    expect(config.OPENCODE_MODEL).toBe("gpt-4o");
    expect(config.OPENCODE_BASE_URL).toBe("https://api.openai.com/v1");
    expect(config.PORT).toBe(8081);
    expect(config.LOG_LEVEL).toBe("info");

    vi.unstubAllEnvs();
  });

  it("should use defaults for optional values", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "sk-test-key");

    const { loadConfig } = await import("@opencode/engine/config/index.js");
    const config = loadConfig();

    expect(config.DB_PATH).toBe("./data/opencode.db");
    expect(config.PORT).toBe(8081);
    expect(config.OPENCODE_WEBSEARCH_PROVIDER).toBe("exa");
    expect(config.OPENCODE_PERMIT_WEBSEARCH).toBe("ask");

    vi.unstubAllEnvs();
  });

  it("should coerce PORT to number", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "sk-test-key");
    vi.stubEnv("PORT", "3000");

    const { loadConfig } = await import("@opencode/engine/config/index.js");
    const config = loadConfig();

    expect(config.PORT).toBe(3000);
    expect(typeof config.PORT).toBe("number");

    vi.unstubAllEnvs();
  });

  it("should exit on missing required variables", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await import("@opencode/engine/config/index.js").then((m) => m.loadConfig());

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("should validate enum values", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "sk-test-key");
    vi.stubEnv("OPENCODE_WEBSEARCH_PROVIDER", "invalid");
    vi.stubEnv("LOG_LEVEL", "invalid");
    vi.stubEnv("OPENCODE_PERMIT_WEBSEARCH", "invalid");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("@opencode/engine/config/index.js").then((m) => m.loadConfig());

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleSpy).toHaveBeenCalled();

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("should return cached config on repeated calls", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "sk-test-key");
    vi.stubEnv("OPENCODE_MODEL", "gpt-4o");

    const { loadConfig, getConfig } = await import("@opencode/engine/config/index.js");
    const config1 = loadConfig();
    const config2 = loadConfig();
    const config3 = getConfig();

    expect(config1).toBe(config2);
    expect(config2).toBe(config3);

    vi.unstubAllEnvs();
  });
});

describe("getConfig", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should throw when config not loaded", async () => {
    const { getConfig } = await import("@opencode/engine/config/index.js");
    expect(() => getConfig()).toThrow("Config not loaded");
  });
});
