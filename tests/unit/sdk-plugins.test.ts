import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPlugins = vi.hoisted(() => {
  class MockPluginRegistry {
    register = vi.fn();
    enable = vi.fn();
    disable = vi.fn();
    list = vi.fn().mockReturnValue([]);
    isEnabled = vi.fn().mockReturnValue(false);
  }
  return {
    PluginRegistry: MockPluginRegistry,
    loadPlugin: vi.fn(),
  };
});

vi.mock("@arely/plugins", () => mockPlugins);
vi.mock("@arely/persistence", () => ({}));
vi.mock("@arely/llm-core", () => ({}));

import { PluginsManager } from "@arely/sdk";

describe("PluginsManager", () => {
  let manager: PluginsManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new PluginsManager();
  });

  it("provides list, enable, disable", () => {
    expect(typeof manager.list).toBe("function");
    expect(typeof manager.enable).toBe("function");
    expect(typeof manager.disable).toBe("function");
  });

  it("delegates isEnabled to registry", () => {
    const result = manager.isEnabled("test");
    expect(result).toBe(false);
  });
});
