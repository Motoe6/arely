import {
  PluginRegistry,
  loadPlugin,
  ComponentPipeline,
  CredentialVault,
  createVault,
  defineCommand,
  type CommandDefinition,
  type ThinkingStrategy,
  type AgentComponent,
} from "@arely/plugins";

export class PluginsManager {
  private registry = new PluginRegistry();
  private vault: CredentialVault | null = null;

  get vaultInstance(): CredentialVault | null {
    return this.vault;
  }

  initVault(masterKey?: string): CredentialVault {
    this.vault = createVault();
    this.vault.initialize(masterKey);
    return this.vault;
  }

  async load(paths: string | string[]): Promise<void> {
    const arr = typeof paths === "string" ? [paths] : paths;
    for (const p of arr) {
      const plugin = await loadPlugin(p);
      this.registry.register(plugin.manifest, plugin.setup);
    }
  }

  async enable(id: string): Promise<void> {
    await this.registry.enable(id);
  }

  disable(id: string): void {
    this.registry.disable(id);
  }

  list(): ReturnType<PluginRegistry["list"]> {
    return this.registry.list();
  }

  isEnabled(id: string): boolean {
    return this.registry.isEnabled(id);
  }

  getRegistry(): PluginRegistry {
    return this.registry;
  }

  getComponentPipeline(): ComponentPipeline {
    return this.registry.getComponentPipeline();
  }

  getStrategy(id: string): ThinkingStrategy | undefined {
    return this.registry.getStrategy(id);
  }

  registerCommand(command: CommandDefinition): void {
    defineCommand(command);
  }

  async initializeComponents(): Promise<void> {
    await this.registry.initializeComponents({ config: {} });
  }

  async cleanupComponents(): Promise<void> {
    await this.registry.cleanupComponents();
  }

  getAllCommands(): CommandDefinition[] {
    return this.registry.getAllCommands();
  }
}
