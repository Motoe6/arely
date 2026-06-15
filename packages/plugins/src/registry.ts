import type { PluginManifest } from "./manifest.js";
import type { ArelyPluginHooks } from "./hooks.js";
import type { PluginSetup, PluginSetupContext } from "./plugin-api.js";
import {
  createCapabilityRegistry,
  type PluginCapabilityRegistry,
} from "./capabilities.js";
import {
  ComponentPipeline,
  type AgentComponent,
  type ComponentContext,
} from "./component-pipeline.js";
import type { ThinkingStrategy, StrategyFactory } from "./strategies/types.js";
import type { CommandDefinition } from "./command.js";
import { getAllCommands, defineCommand } from "./command.js";

interface PluginEntry {
  manifest: PluginManifest;
  setup: PluginSetup;
  enabled: boolean;
  hooks?: ArelyPluginHooks;
  components?: AgentComponent[];
  strategies?: Map<string, ThinkingStrategy>;
  commands?: CommandDefinition[];
}

export class PluginRegistry {
  private plugins = new Map<string, PluginEntry>();
  private hooksList: ArelyPluginHooks[] = [];
  private capabilities: PluginCapabilityRegistry = createCapabilityRegistry();
  private pipeline = new ComponentPipeline();
  private strategyFactories = new Map<string, StrategyFactory>();

  register(manifest: PluginManifest, setup: PluginSetup): void {
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin "${manifest.id}" is already registered`);
    }
    this.plugins.set(manifest.id, { manifest, setup, enabled: false });
  }

  async enable(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) throw new Error(`Plugin "${id}" not found`);
    if (entry.enabled) return;

    const ctx = this.createSetupContext(id);
    await entry.setup(ctx);

    entry.hooks = ctx.hooks;
    if (ctx.hooks && Object.keys(ctx.hooks).length > 0) {
      this.hooksList.push(ctx.hooks);
    }

    if (ctx.capabilities.components.size > 0) {
      entry.components = [];
      for (const [, comp] of ctx.capabilities.components) {
        this.pipeline.register(comp);
        entry.components.push(comp);
      }
    }

    if (ctx.capabilities.strategiesRuntime.size > 0) {
      entry.strategies = new Map(ctx.capabilities.strategiesRuntime);
    }

    if (ctx.capabilities.commands.size > 0) {
      entry.commands = [];
      for (const [, cmd] of ctx.capabilities.commands) {
        defineCommand(cmd);
        entry.commands.push(cmd);
      }
    }

    entry.enabled = true;
  }

  disable(id: string): void {
    const entry = this.plugins.get(id);
    if (!entry) throw new Error(`Plugin "${id}" not found`);
    if (!entry.enabled) return;

    if (entry.hooks) {
      this.hooksList = this.hooksList.filter((h) => h !== entry.hooks);
    }

    if (entry.components) {
      for (const comp of entry.components) {
        this.pipeline.unregister(comp.id);
      }
    }

    entry.enabled = false;
  }

  list(): Array<{
    id: string;
    name: string;
    version: string;
    enabled: boolean;
    capabilities?: string[];
    componentCount?: number;
    commandCount?: number;
  }> {
    return Array.from(this.plugins.values()).map((e) => ({
      id: e.manifest.id,
      name: e.manifest.name,
      version: e.manifest.version,
      enabled: e.enabled,
      capabilities: e.manifest.capabilities,
      componentCount: e.components?.length,
      commandCount: e.commands?.length,
    }));
  }

  isEnabled(id: string): boolean {
    return this.plugins.get(id)?.enabled ?? false;
  }

  getCapabilityRegistry(): PluginCapabilityRegistry {
    return this.capabilities;
  }

  getComponentPipeline(): ComponentPipeline {
    return this.pipeline;
  }

  getHooks(): ArelyPluginHooks {
    const list = this.hooksList;
    if (list.length === 0) return {};
    return {
      beforeToolCall: async (ctx) => {
        for (const h of list) {
          const r = await h.beforeToolCall?.(ctx);
          if (r?.block) return r;
        }
      },
      afterToolCall: async (ctx) => { for (const h of list) await h.afterToolCall?.(ctx); },
      beforeMemoryStore: async (ctx) => { for (const h of list) await h.beforeMemoryStore?.(ctx); },
      afterMemoryStore: async (ctx) => { for (const h of list) await h.afterMemoryStore?.(ctx); },
      beforeDecision: async (ctx) => { for (const h of list) await h.beforeDecision?.(ctx); },
      afterDecision: async (ctx) => { for (const h of list) await h.afterDecision?.(ctx); },
      beforeStrategySelection: async (ctx) => { for (const h of list) await h.beforeStrategySelection?.(ctx); },
      afterStrategySelection: async (ctx) => { for (const h of list) await h.afterStrategySelection?.(ctx); },
      beforePrediction: async (ctx) => { for (const h of list) await h.beforePrediction?.(ctx); },
      afterPrediction: async (ctx) => { for (const h of list) await h.afterPrediction?.(ctx); },
      beforeVaultAccess: async (ctx) => {
        for (const h of list) {
          const r = await h.beforeVaultAccess?.(ctx);
          if (r?.block) return r;
        }
      },
      afterVaultAccess: async (ctx) => { for (const h of list) await h.afterVaultAccess?.(ctx); },
      beforeExecution: async (ctx) => { for (const h of list) await h.beforeExecution?.(ctx); },
      afterExecution: async (ctx) => { for (const h of list) await h.afterExecution?.(ctx); },
      beforeAgentCycle: async (ctx) => { for (const h of list) await h.beforeAgentCycle?.(ctx); },
      afterAgentCycle: async (ctx) => { for (const h of list) await h.afterAgentCycle?.(ctx); },
      onComponentInit: async (ctx) => { for (const h of list) await h.onComponentInit?.(ctx); },
      onComponentCleanup: async (ctx) => { for (const h of list) await h.onComponentCleanup?.(ctx); },
    };
  }

  getStrategy(id: string): ThinkingStrategy | undefined {
    for (const [, entry] of this.plugins) {
      if (entry.strategies?.has(id)) return entry.strategies.get(id);
    }
    const factory = this.strategyFactories.get(id);
    if (factory) {
      const strategy = factory();
      return strategy;
    }
    return undefined;
  }

  /** Initialize all component pipelines */
  async initializeComponents(ctx: ComponentContext): Promise<void> {
    await this.pipeline.initializeAll(ctx);
  }

  /** Cleanup all component pipelines */
  async cleanupComponents(): Promise<void> {
    await this.pipeline.cleanupAll();
  }

  /** Get all registered commands */
  getAllCommands(): CommandDefinition[] {
    return getAllCommands();
  }

  private createSetupContext(pluginId: string): PluginSetupContext {
    const reg = this.capabilities;
    const ctx: PluginSetupContext = {
      capabilities: reg,
      componentContext: { config: {}, abortSignal: undefined },

      registerTool(name, description, execute) {
        reg.tools.set(name, { name, description, execute });
      },

      registerPredictor(r) {
        reg.predictors.set(r.id, r);
      },

      registerStrategy(r) {
        reg.strategies.set(r.id, r);
      },

      registerStrategyRuntime(id, strategy) {
        reg.strategiesRuntime.set(id, strategy);
      },

      registerStrategyFactory(id, factory) {
        this.strategyFactories?.set(id, factory);
      },

      registerMemoryExtractor(r) {
        reg.memoryExtractors.set(r.id, r);
      },

      registerEvolutionRule(r) {
        reg.evolutionRules.set(r.id, r);
      },

      registerProvider(r) {
        reg.providers.set(r.id, r);
      },

      registerComponent(component) {
        reg.components.set(component.id, component);
      },

      registerCommand(command) {
        reg.commands.set(command.names[0], command);
        defineCommand(command);
      },

      registerCommands(commands) {
        for (const cmd of commands) {
          reg.commands.set(cmd.names[0], cmd);
          defineCommand(cmd);
        }
      },

      hooks: {} as ArelyPluginHooks,
      strategyFactories: this.strategyFactories,
    };
    return ctx;
  }

}
