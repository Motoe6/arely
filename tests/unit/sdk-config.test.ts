import { describe, it, expect } from "vitest";
import { resolveConfig, getEnvConfig } from "@arely/sdk";

describe("resolveConfig", () => {
  it("returns defaults with empty input", () => {
    const cfg = resolveConfig({});
    expect(cfg.provider).toBe("ollama");
    expect(cfg.model).toBe("deepseek-r1");
    expect(cfg.maxIterations).toBe(20);
    expect(cfg.memoryEnabled).toBe(true);
  });

  it("overrides defaults with provided values", () => {
    const cfg = resolveConfig({ provider: "openai", model: "gpt-4" });
    expect(cfg.provider).toBe("openai");
    expect(cfg.model).toBe("gpt-4");
  });

  it("preserves partial overrides", () => {
    const cfg = resolveConfig({ maxIterations: 5 });
    expect(cfg.maxIterations).toBe(5);
    expect(cfg.provider).toBe("ollama");
  });
});

describe("getEnvConfig", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env["ARELY_PROVIDER"];
    delete process.env["ARELY_MODEL"];
    delete process.env["ARELY_DB_PATH"];
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("returns empty object when no env vars set", () => {
    const cfg = getEnvConfig();
    expect(cfg).toEqual({});
  });

  it("reads values from environment", () => {
    process.env["ARELY_PROVIDER"] = "anthropic";
    process.env["ARELY_MODEL"] = "claude-3";
    process.env["ARELY_DB_PATH"] = "/tmp/test.db";
    const cfg = getEnvConfig();
    expect(cfg.provider).toBe("anthropic");
    expect(cfg.model).toBe("claude-3");
    expect(cfg.dbPath).toBe("/tmp/test.db");
  });
});
