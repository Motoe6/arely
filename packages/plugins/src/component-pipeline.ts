import type { ToolContext } from "./command.js";

export interface ComponentContext {
  config: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export interface AgentComponent {
  readonly id: string;
  readonly name: string;
  readonly runAfter?: string[];
  readonly enabled?: boolean | (() => boolean);
  readonly provides: string[];
  initialize?(ctx: ComponentContext): void | Promise<void>;
  cleanup?(): void | Promise<void>;
}

export interface DirectiveProvider extends AgentComponent {
  provides: ["directive-provider"];
  getDirectives(): Array<{ type: "constraint" | "resource" | "best-practice"; content: string }>;
}

export interface ToolProvider extends AgentComponent {
  provides: ["tool-provider"];
  getToolRegistrations(): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
  }>;
}

export interface MessageProvider extends AgentComponent {
  provides: ["message-provider"];
  getSystemMessages?(): Array<{ role: "system"; content: string }>;
  getContextMessages?(): Array<{ role: "user" | "assistant" | "system"; content: string }>;
}

export interface MemoryProvider extends AgentComponent {
  provides: ["memory-provider"];
  getMemoryEntries(): Array<{ key: string; value: string; type: string; confidence: number }>;
}

export interface ExecutionHook extends AgentComponent {
  provides: ["execution-hook"];
  beforeExecution?(ctx: { toolName: string; args: unknown }): Promise<{ block?: boolean; reason?: string } | void>;
  afterExecution?(ctx: { toolName: string; args: unknown; result: string; isError: boolean }): Promise<void>;
  onError?(ctx: { toolName: string; args: unknown; error: string }): Promise<void>;
}

export interface PredictionProvider extends AgentComponent {
  provides: ["prediction-provider"];
  getPredictors(): Array<{
    id: string;
    predict(input: { decisionType: string; context: Record<string, unknown> }): Promise<{ successProbability: number; confidence: number }>;
  }>;
}

export interface StrategyProvider extends AgentComponent {
  provides: ["strategy-provider"];
  getStrategies(): Array<{
    id: string;
    name: string;
    select(context: { goal: string; availableActions: string[] }): Promise<{ recommendedAction: string; reasoning: string }>;
  }>;
}

export interface ConfigProvider extends AgentComponent {
  provides: ["config-provider"];
  getConfigSchema(): Record<string, { type: string; default?: unknown; description?: string; fromEnv?: string }>;
}

export type AnyComponent = AgentComponent & Record<string, unknown>;

export class ComponentPipeline {
  private components = new Map<string, AgentComponent>();

  register(component: AgentComponent): void {
    if (this.components.has(component.id)) {
      throw new Error(`Component "${component.id}" already registered`);
    }
    this.components.set(component.id, component);
  }

  unregister(id: string): void {
    this.components.delete(id);
  }

  get<T extends AgentComponent>(id: string): T | undefined {
    return this.components.get(id) as T | undefined;
  }

  getAll(): AgentComponent[] {
    return Array.from(this.components.values());
  }

  findByProtocol(protocolTag: string): AgentComponent[] {
    return Array.from(this.components.values()).filter((c) => c.provides.includes(protocolTag));
  }

  findEnabledByProtocol(protocolTag: string): AgentComponent[] {
    return this.findByProtocol(protocolTag).filter((c) => {
      if (typeof c.enabled === "function") return c.enabled();
      return c.enabled !== false;
    });
  }

  sort(): AgentComponent[] {
    const sorted: AgentComponent[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const items = Array.from(this.components.values());

    function visit(node: AgentComponent, graph: Map<string, AgentComponent>): void {
      if (visited.has(node.id)) return;
      if (visiting.has(node.id)) throw new Error(`Cyclic dependency detected involving "${node.id}"`);
      visiting.add(node.id);
      for (const depId of node.runAfter ?? []) {
        const dep = graph.get(depId);
        if (dep) visit(dep, graph);
      }
      visiting.delete(node.id);
      visited.add(node.id);
      sorted.push(node);
    }

    const graph = new Map(items.map((c) => [c.id, c]));
    for (const comp of items) {
      if (!visited.has(comp.id)) visit(comp, graph);
    }

    return sorted;
  }

  async initializeAll(ctx: ComponentContext): Promise<void> {
    const sorted = this.sort();
    for (const comp of sorted) {
      if (typeof comp.enabled === "function" ? comp.enabled() : comp.enabled !== false) {
        await comp.initialize?.(ctx);
      }
    }
  }

  async cleanupAll(): Promise<void> {
    const sorted = this.sort().reverse();
    for (const comp of sorted) {
      await comp.cleanup?.();
    }
  }

  /** Collect directives from all enabled DirectiveProvider components */
  collectDirectives(): Array<{ type: "constraint" | "resource" | "best-practice"; content: string }> {
    const results: Array<{ type: "constraint" | "resource" | "best-practice"; content: string }> = [];
    for (const comp of this.findEnabledByProtocol("directive-provider")) {
      const dp = comp as unknown as DirectiveProvider;
      results.push(...dp.getDirectives());
    }
    return results;
  }

  /** Collect tool registrations from all enabled ToolProvider components */
  collectTools(): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
  }> {
    const results: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
    }> = [];
    for (const comp of this.findEnabledByProtocol("tool-provider")) {
      const tp = comp as unknown as ToolProvider;
      results.push(...tp.getToolRegistrations());
    }
    return results;
  }

  /** Collect system messages from all enabled MessageProvider components */
  collectSystemMessages(): string[] {
    const messages: string[] = [];
    for (const comp of this.findEnabledByProtocol("message-provider")) {
      const mp = comp as unknown as MessageProvider;
      if (mp.getSystemMessages) {
        messages.push(...mp.getSystemMessages().map((m) => m.content));
      }
    }
    return messages;
  }

  /** Collect memory entries from all enabled MemoryProvider components */
  collectMemoryEntries(): Array<{ key: string; value: string; type: string; confidence: number }> {
    const results: Array<{ key: string; value: string; type: string; confidence: number }> = [];
    for (const comp of this.findEnabledByProtocol("memory-provider")) {
      const mp = comp as unknown as MemoryProvider;
      results.push(...mp.getMemoryEntries());
    }
    return results;
  }

  /** Get before/after execution hooks from all enabled ExecutionHook components */
  getExecutionHooks(): {
    before: Array<(ctx: { toolName: string; args: unknown }) => Promise<{ block?: boolean; reason?: string } | void>>;
    after: Array<(ctx: { toolName: string; args: unknown; result: string; isError: boolean }) => Promise<void>>;
    onError: Array<(ctx: { toolName: string; args: unknown; error: string }) => Promise<void>>;
  } {
    const hooks: {
      before: Array<(ctx: { toolName: string; args: unknown }) => Promise<{ block?: boolean; reason?: string } | void>>;
      after: Array<(ctx: { toolName: string; args: unknown; result: string; isError: boolean }) => Promise<void>>;
      onError: Array<(ctx: { toolName: string; args: unknown; error: string }) => Promise<void>>;
    } = { before: [], after: [], onError: [] };

    for (const comp of this.findEnabledByProtocol("execution-hook")) {
      const eh = comp as unknown as ExecutionHook;
      if (eh.beforeExecution) hooks.before.push((ctx) => eh.beforeExecution!(ctx));
      if (eh.afterExecution) hooks.after.push((ctx) => eh.afterExecution!(ctx));
      if (eh.onError) hooks.onError.push((ctx) => eh.onError!(ctx));
    }

    return hooks;
  }

  count(): number {
    return this.components.size;
  }
}
