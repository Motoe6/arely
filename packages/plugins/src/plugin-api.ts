import type { ArelyPluginHooks } from "./hooks.js";
import type {
  PluginCapabilityRegistry,
  PredictorRegistration,
  StrategyRegistration,
  MemoryExtractorRegistration,
  EvolutionRuleRegistration,
  ProviderRegistration,
} from "./capabilities.js";
import type { AgentComponent, ComponentContext } from "./component-pipeline.js";
import type { ThinkingStrategy, StrategyFactory } from "./strategies/types.js";
import type { CommandDefinition } from "./command.js";

export interface PluginSetupContext {
  capabilities: PluginCapabilityRegistry;
  strategyFactories: Map<string, StrategyFactory>;

  registerTool(
    name: string,
    description: string,
    execute: (args: Record<string, unknown>) => Promise<string>,
  ): void;

  registerPredictor(registration: PredictorRegistration): void;
  registerStrategy(registration: StrategyRegistration): void;
  registerMemoryExtractor(registration: MemoryExtractorRegistration): void;
  registerEvolutionRule(registration: EvolutionRuleRegistration): void;
  registerProvider(registration: ProviderRegistration): void;

  /** Register a ThinkingStrategy runtime instance (from AutoGPT strategy patterns) */
  registerStrategyRuntime(id: string, strategy: ThinkingStrategy): void;

  /** Register an AgentComponent (from AutoGPT component pipeline) */
  registerComponent(component: AgentComponent): void;

  /** Register a CommandDefinition (from AutoGPT @command pattern) */
  registerCommand(command: CommandDefinition): void;

  /** Register multiple commands at once */
  registerCommands(commands: CommandDefinition[]): void;

  /** Register a ThinkingStrategy factory class (lazy-initialized) */
  registerStrategyFactory(id: string, factory: StrategyFactory): void;

  /** Get the component context for initialization */
  componentContext: ComponentContext;

  hooks: ArelyPluginHooks;
}

export type PluginSetup = (ctx: PluginSetupContext) => void | Promise<void>;

export interface ArelyPlugin {
  manifest: { id: string; name: string; version: string; description?: string };
  setup: PluginSetup;
}

export function definePlugin(
  manifest: ArelyPlugin["manifest"],
  setup: PluginSetup,
): ArelyPlugin {
  return { manifest, setup };
}
