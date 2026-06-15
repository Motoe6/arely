// ── Core Plugin System ──
export { PluginRegistry } from "./registry.js";
export { definePlugin } from "./plugin-api.js";
export { loadPlugin, loadPluginsInto } from "./loader.js";
export { isValidCapability, PLUGIN_CAPABILITIES } from "./manifest.js";
export type { PluginManifest, PluginCapability } from "./manifest.js";
export type { PluginSetup, PluginSetupContext, ArelyPlugin } from "./plugin-api.js";
export type {
  ArelyPluginHooks,
  BeforeToolCallContext,
  AfterToolCallContext,
  BeforeVaultAccessContext,
  AfterVaultAccessContext,
  BeforeExecutionContext,
  AfterExecutionContext,
  BeforeAgentCycleContext,
  AfterAgentCycleContext,
  ComponentLifecycleContext,
  HookName,
  mergeHooks,
} from "./hooks.js";

// ── Component Pipeline (from AutoGPT) ──
export {
  ComponentPipeline,
  type AgentComponent,
  type ComponentContext,
  type DirectiveProvider,
  type ToolProvider,
  type MessageProvider,
  type MemoryProvider,
  type ExecutionHook,
  type PredictionProvider,
  type StrategyProvider,
  type ConfigProvider,
  type AnyComponent,
} from "./component-pipeline.js";

// ── Capabilities Registry ──
export type {
  PluginCapabilityRegistry,
  PredictorRegistration,
  StrategyRegistration,
  MemoryExtractorRegistration,
  EvolutionRuleRegistration,
  ProviderRegistration,
  PredictorInput,
  PredictorOutput,
  StrategyContext,
  StrategyResult,
  MemoryExtractorInput,
  MemoryExtractorOutput,
  EvolutionRuleInput,
  EvolutionRuleOutput,
} from "./capabilities.js";
export { createCapabilityRegistry, registerAllComponents, registerStrategyRuntime } from "./capabilities.js";

// ── Command System (from AutoGPT @command pattern) ──
export {
  defineCommand,
  getCommand,
  getAllCommands,
  clearCommands,
  buildFunctionSpecs,
  executeCommand,
  type CommandDefinition,
  type CommandParameter,
  type ToolContext,
  type ToolResult,
} from "./command.js";

// ── Thinking Strategies (from AutoGPT prompt strategies) ──
export type {
  ThinkingStrategy,
  StrategyInput,
  StrategyOutput,
  StrategyStep,
  StrategyFactory,
} from "./strategies/types.js";
export { OneShotStrategy } from "./strategies/one-shot.js";
export { ReWOOStrategy } from "./strategies/rewoo.js";
export { ReflexionStrategy } from "./strategies/reflexion.js";
export { TreeOfThoughtsStrategy } from "./strategies/tree-of-thoughts.js";
export { MultiAgentDebateStrategy } from "./strategies/multi-agent-debate.js";

// ── Credential Vault (from n8n AES-256-GCM) ──
export {
  CredentialVault,
  EnvVaultProvider,
  createVault,
  type VaultEntry,
  type VaultProvider,
} from "./vault.js";

// ── Expression Sandboxing (from n8n isolated-vm pattern) ──
export {
  resolveExpression,
  renderTemplate,
  renderTemplateStrict,
  hasExpressions,
  ExpressionError,
  type ExpressionContext,
} from "./expressions.js";
