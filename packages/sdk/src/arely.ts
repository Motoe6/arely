import { createModel, ProviderBridgeAdapter, registerBuiltInApiProviders } from "@arelyos/llm-core";
import { connect as dbConnect, close as dbClose, createInMemoryDb, pushSchema } from "@arelyos/persistence";
import type { DeepPartial, ArelyConfig, ArelyTool } from "./config.js";
import { resolveConfig, getEnvConfig } from "./config.js";
import { ChatSession, type ChatOptions } from "./chat.js";
import { AgentSession, type AgentOptions } from "./agent.js";
import { Memory } from "./memory.js";
import { PluginsManager } from "./plugins.js";

export class Arely {
  private config: ArelyConfig;
  private llm: ProviderBridgeAdapter | null = null;
  private chatSession: ChatSession | null = null;
  private agentSession: AgentSession | null = null;
  public memory: Memory;
  public plugins: PluginsManager;
  private dbConnected = false;

  constructor(config: DeepPartial<ArelyConfig> = {}) {
    this.config = resolveConfig({ ...getEnvConfig(), ...config });
    this.memory = new Memory();
    this.plugins = new PluginsManager();
  }

  async connect(): Promise<void> {
    registerBuiltInApiProviders();

    const model = createModel({
      provider: this.config.provider,
      model: this.config.model,
      baseUrl: this.config.baseUrl ?? "",
      apiKey: this.config.apiKey,
    });
    this.llm = new ProviderBridgeAdapter(model, this.config.apiKey);

    if (this.config.dbPath) {
      dbConnect(this.config.dbPath);
      pushSchema();
      this.dbConnected = true;
      this.memory.markConnected();
    }
  }

  async chat(message: string, options?: ChatOptions): Promise<string> {
    if (!this.llm) await this.connect();
    if (!this.chatSession) {
      this.chatSession = new ChatSession(this.llm!);
    }
    return this.chatSession.send(message, options);
  }

  async agent(prompt: string, options?: AgentOptions): Promise<{ content: string; turns: number }> {
    if (!this.llm) await this.connect();
    if (!this.agentSession) {
      this.agentSession = new AgentSession(this.llm!);
    }
    return this.agentSession.run(prompt, {
      ...options,
      tools: [...(this.config.tools ?? []), ...(options?.tools ?? [])],
    });
  }

  async close(): Promise<void> {
    if (this.dbConnected) {
      dbClose();
      this.dbConnected = false;
    }
    this.llm = null;
    this.chatSession = null;
    this.agentSession = null;
  }
}
