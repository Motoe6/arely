import { describe, it, expect, vi, beforeEach } from "vitest";

// Need to import distributed modules dynamically because they have side effects
async function getTestModules() {
  const { WorkerRegistry } = await import("@arelyos/distributed/registry");
  const { DiscoveryManager } = await import("@arelyos/distributed");
  const { StaticDiscovery } = await import("@arelyos/distributed");
  return { WorkerRegistry, DiscoveryManager, StaticDiscovery };
}

function fakeWorkerInfo(workerId: string, host = "127.0.0.1", port = 9092, providers = ["openai"], models = ["gpt-4o"]) {
  return {
    workerId,
    host,
    port,
    version: "1.0.0",
    capabilities: ["llm"] as const,
    providers,
    models,
    startedAt: Date.now(),
  };
}

describe("DiscoveryManager", () => {
  let registry: InstanceType<Awaited<ReturnType<typeof getTestModules>>["WorkerRegistry"]>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await getTestModules();
    registry = new mod.WorkerRegistry();
  });

  it("should register workers via onJoin callback", async () => {
    vi.resetModules();
    const mod = await getTestModules();
    const registry2 = new mod.WorkerRegistry();
    let joinCb: ((w: any) => void) | undefined;
    const testProvider = {
      name: "test",
      start: async () => {},
      stop: async () => {},
      refresh: async () => [],
      onJoin: (cb: (w: any) => void) => { joinCb = cb; },
      onLeave: () => {},
    };
    const mgr = new mod.DiscoveryManager([testProvider], registry2);
    await mgr.start();
    joinCb!(fakeWorkerInfo("w1"));
    joinCb!(fakeWorkerInfo("w2"));

    expect(registry2.get("w1")).toBeDefined();
    expect(registry2.get("w2")).toBeDefined();
    expect(registry2.getOnline().length).toBe(2);
    await mgr.stop();
  });

  it("should mark worker offline via onLeave callback", async () => {
    vi.resetModules();
    const mod = await getTestModules();
    const registry2 = new mod.WorkerRegistry();
    let joinCb: ((w: any) => void) | undefined;
    let leaveCb: ((id: string) => void) | undefined;
    const testProvider = {
      name: "test",
      start: async () => {},
      stop: async () => {},
      refresh: async () => [],
      onJoin: (cb: (w: any) => void) => { joinCb = cb; },
      onLeave: (cb: (id: string) => void) => { leaveCb = cb; },
    };
    const mgr = new mod.DiscoveryManager([testProvider], registry2);
    await mgr.start();
    joinCb!(fakeWorkerInfo("w1"));
    joinCb!(fakeWorkerInfo("w2"));
    expect(registry2.getOnline().length).toBe(2);

    leaveCb!("w1");
    expect(registry2.get("w1")?.status).toBe("offline");
    expect(registry2.getOnline().length).toBe(1);
    await mgr.stop();
  });

  it("should handle join of already-registered worker without duplication", async () => {
    vi.resetModules();
    const mod = await getTestModules();
    const registry2 = new mod.WorkerRegistry();
    let joinCb: ((w: any) => void) | undefined;
    const testProvider = {
      name: "test",
      start: async () => {},
      stop: async () => {},
      refresh: async () => [],
      onJoin: (cb: (w: any) => void) => { joinCb = cb; },
      onLeave: () => {},
    };
    const mgr = new mod.DiscoveryManager([testProvider], registry2);
    await mgr.start();
    joinCb!(fakeWorkerInfo("w1"));
    expect(registry2.size()).toBe(1);

    joinCb!(fakeWorkerInfo("w1"));
    expect(registry2.size()).toBe(1);
    expect(registry2.get("w1")?.worker.host).toBe("127.0.0.1");
    await mgr.stop();
  });

  it("should discover workers via static provider", async () => {
    vi.resetModules();
    const mod = await getTestModules();
    const registry2 = new mod.WorkerRegistry();
    const staticProv = new mod.StaticDiscovery({
      workers: [
        { workerId: "static-1", host: "10.0.0.1", port: 9092, providers: ["openai"], models: ["gpt-4o"] },
        { workerId: "static-2", host: "10.0.0.2", port: 9092, providers: ["ollama"], models: ["qwen2.5"] },
      ],
    });
    const mgr = new mod.DiscoveryManager([staticProv], registry2);
    await mgr.start();
    await mgr.stop();

    expect(registry2.size()).toBe(2);
    expect(registry2.get("static-1")?.worker.host).toBe("10.0.0.1");
    expect(registry2.get("static-2")?.worker.providers).toEqual(["ollama"]);
  });

  it("should discover 100 workers concurrently and not miss any", async () => {
    vi.resetModules();
    const mod = await getTestModules();
    const registry2 = new mod.WorkerRegistry();

    const workers = Array.from({ length: 100 }, (_, i) => ({
      workerId: `w-${i}`,
      host: "10.0.0.1",
      port: 9092 + i,
      providers: ["openai"] as string[],
      models: ["gpt-4o"] as string[],
    }));

    const staticProv = new mod.StaticDiscovery({ workers });
    const mgr = new mod.DiscoveryManager([staticProv], registry2);
    await mgr.start();
    await mgr.stop();

    expect(registry2.size()).toBe(100);
    const online = registry2.getOnline();
    expect(online.length).toBe(100);
  });

  it("should not crash when provider.refresh throws", async () => {
    vi.resetModules();
    const mod = await getTestModules();
    const registry2 = new mod.WorkerRegistry();
    const errorProvider = {
      name: "broken",
      start: async () => {},
      stop: async () => {},
      refresh: async () => { throw new Error("connection refused"); },
      onJoin: () => {},
      onLeave: () => {},
    };

    const mgr = new mod.DiscoveryManager([errorProvider], registry2);
    await mgr.start();
    expect(registry2.size()).toBe(0);
    await mgr.stop();
  });

  it("should recover after a provider returns to health", async () => {
    vi.resetModules();
    const mod = await getTestModules();
    const registry2 = new mod.WorkerRegistry();
    let healthy = false;
    const flakeyProvider = {
      name: "flakey",
      start: async () => {},
      stop: async () => {},
      refresh: async () => {
        if (!healthy) throw new Error("not ready");
        return [{ workerId: "ok", host: "1.2.3.4", port: 9092, version: "1.0.0", capabilities: ["llm"] as const, providers: ["openai"] as string[], models: ["gpt-4o"] as string[], startedAt: Date.now() }];
      },
      onJoin: () => {},
      onLeave: () => {},
    };

    const mgr = new mod.DiscoveryManager([flakeyProvider], registry2);
    await mgr.start();

    // First refresh fails — no workers yet
    expect(registry2.size()).toBe(0);

    // Provider recovers
    healthy = true;
    await (mgr as any).refresh();

    expect(registry2.size()).toBe(1);
    expect(registry2.get("ok")?.status).toBe("online");
    await mgr.stop();
  });
});
