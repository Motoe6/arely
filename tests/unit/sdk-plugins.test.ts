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

vi.mock("@arelyos/plugins", () => mockPlugins);
vi.mock("@arelyos/persistence", () => ({}));
vi.mock("@arelyos/llm-core", () => ({}));

import { PluginsManager } from "@arelyos/sdk";

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
