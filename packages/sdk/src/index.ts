export { Arely } from "./arely.js";
export { Memory } from "./memory.js";
export { ChatSession } from "./chat.js";
export { AgentSession } from "./agent.js";
export { PluginsManager } from "./plugins.js";
export { resolveConfig, getEnvConfig } from "./config.js";
export type { ArelyConfig, ArelyTool, DeepPartial } from "./config.js";
export type { ChatOptions } from "./chat.js";
export type { AgentOptions } from "./agent.js";

// Re-export key types from @arely/plugins for convenience
export type {
  ThinkingStrategy as ArelyThinkingStrategy,
  StrategyInput as ArelyStrategyInput,
  StrategyOutput as ArelyStrategyOutput,
  StrategyStep as ArelyStrategyStep,
  CommandDefinition as ArelyCommandDefinition,
  CommandParameter as ArelyCommandParameter,
  AgentComponent as ArelyAgentComponent,
  ComponentPipeline as ArelyComponentPipeline,
  CredentialVault as ArelyCredentialVault,
  VaultEntry as ArelyVaultEntry,
  ExpressionContext as ArelyExpressionContext,
} from "@arely/plugins";

export {
  OneShotStrategy,
  ReWOOStrategy,
  ReflexionStrategy,
  TreeOfThoughtsStrategy,
  MultiAgentDebateStrategy,
  defineCommand as defineArelyCommand,
  getCommand as getArelyCommand,
  buildFunctionSpecs as buildArelyFunctionSpecs,
} from "@arely/plugins";
