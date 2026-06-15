import type { PluginCapability } from "./manifest.js";
import type {
  AgentComponent,
  DirectiveProvider,
  ToolProvider,
  MessageProvider,
  MemoryProvider,
  ExecutionHook,
  PredictionProvider,
  StrategyProvider,
  ConfigProvider,
} from "./component-pipeline.js";
import type { ThinkingStrategy } from "./strategies/types.js";
import type { CommandDefinition } from "./command.js";

export interface PluginCapabilityRegistry {
  tools: Map<string, { name: string; description: string; execute: (args: Record<string, unknown>) => Promise<string> }>;
  predictors: Map<string, PredictorRegistration>;
  strategies: Map<string, StrategyRegistration>;
  strategiesRuntime: Map<string, ThinkingStrategy>;
  memoryExtractors: Map<string, MemoryExtractorRegistration>;
  evolutionRules: Map<string, EvolutionRuleRegistration>;
  providers: Map<string, ProviderRegistration>;
  components: Map<string, AgentComponent>;
  commands: Map<string, CommandDefinition>;
  directives: Array<{ type: "constraint" | "resource" | "best-practice"; content: string }>;
}

export interface PredictorRegistration {
  id: string;
  predict: (input: PredictorInput) => Promise<PredictorOutput>;
}

export interface PredictorInput {
  decisionType: string;
  context: Record<string, unknown>;
  history: Array<{ decisionType: string; outcome: string }>;
}

export interface PredictorOutput {
  successProbability: number;
  confidence: number;
}

export interface StrategyRegistration {
  id: string;
  name: string;
  select: (context: StrategyContext) => Promise<StrategyResult>;
}

export interface StrategyContext {
  goal: string;
  availableActions: string[];
  memory: Array<{ key: string; value: string }>;
}

export interface StrategyResult {
  recommendedAction: string;
  reasoning: string;
}

export interface MemoryExtractorRegistration {
  id: string;
  extract: (input: MemoryExtractorInput) => Promise<MemoryExtractorOutput>;
}

export interface MemoryExtractorInput {
  content: string;
  sessionId: string;
}

export interface MemoryExtractorOutput {
  memories: Array<{ key: string; value: string; type: string; confidence: number }>;
}

export interface EvolutionRuleRegistration {
  id: string;
  evaluate: (input: EvolutionRuleInput) => Promise<EvolutionRuleOutput>;
}

export interface EvolutionRuleInput {
  templateId: string;
  performance: Record<string, number>;
}

export interface EvolutionRuleOutput {
  shouldEvolve: boolean;
  suggestions: string[];
}

export interface ProviderRegistration {
  id: string;
  type: string;
  setup: (config: Record<string, unknown>) => Promise<void>;
}

export function createCapabilityRegistry(): PluginCapabilityRegistry {
  return {
    tools: new Map(),
    predictors: new Map(),
    strategies: new Map(),
    strategiesRuntime: new Map(),
    memoryExtractors: new Map(),
    evolutionRules: new Map(),
    providers: new Map(),
    components: new Map(),
    commands: new Map(),
    directives: [],
  };
}

export function registerAllComponents(
  registry: PluginCapabilityRegistry,
  components: AgentComponent[],
): void {
  for (const comp of components) {
    registry.components.set(comp.id, comp);

    if (comp.provides.includes("directive-provider")) {
      const dp = comp as unknown as DirectiveProvider;
      registry.directives.push(...dp.getDirectives());
    }

    if (comp.provides.includes("tool-provider")) {
      const tp = comp as unknown as ToolProvider;
      for (const reg of tp.getToolRegistrations()) {
        registry.tools.set(reg.name, {
          name: reg.name,
          description: reg.description,
          execute: (args) => reg.execute(args, { sessionId: "" }),
        });
      }
    }

    if (comp.provides.includes("strategy-provider")) {
      const sp = comp as unknown as StrategyProvider;
      for (const s of sp.getStrategies()) {
        registry.strategies.set(s.id, s);
      }
    }

    if (comp.provides.includes("prediction-provider")) {
      const pp = comp as unknown as PredictionProvider;
      for (const p of pp.getPredictors()) {
        registry.predictors.set(p.id, p);
      }
    }

    if (comp.provides.includes("memory-provider")) {
      const mp = comp as unknown as MemoryProvider;
      for (const entry of mp.getMemoryEntries()) {
        registry.memoryExtractors.set(entry.key, {
          id: entry.key,
          extract: async () => ({ memories: [entry] }),
        });
      }
    }
  }
}

export function registerStrategyRuntime(
  registry: PluginCapabilityRegistry,
  id: string,
  strategy: ThinkingStrategy,
): void {
  registry.strategiesRuntime.set(id, strategy);
}
