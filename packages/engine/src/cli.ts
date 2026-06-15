#!/usr/bin/env node
import * as p from "@clack/prompts";
import { loadConfig, getConfig } from "./config/index.js";
import { connect } from "./persistence/database.js";
import { pushSchema } from "./persistence/migrate.js";
import * as readline from "node:readline";
import type { UserConfig } from "./cli/config.js";
import { loadUserConfig, saveUserConfig, setDefaultModel, toggleModel } from "./cli/config.js";
import { detectOllama, fetchOllamaModelDefs } from "./cli/ollama.js";
import {
  intro, outro, note, spinner, log, cancel, isCancel,
  green, red, dim, bold, cyan, renderBrand,
} from "./cli/menu.js";
import { modelPerformanceService } from "./llm/model-performance-service.js";

const ALL_PROVIDERS = ["ollama", "openai", "anthropic", "lmstudio", "local"] as const;

function rl(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function setEnv(key: string, value: string): void {
  process.env[key] = value;
}

/* ── Model detection ─────────────────────────────────────────── */

async function detectModelsForProvider(provider: string): Promise<string[]> {
  if (provider === "ollama") {
    const defs = await fetchOllamaModelDefs();
    return defs.map((m) => m.name);
  }
  if (provider === "lmstudio") {
    try {
      const res = await fetch("http://localhost:1234/v1/models", { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        return data.data?.map((m) => m.id) ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }
  if (provider === "openai") {
    return ["gpt-4o", "gpt-4o-mini", "gpt-5.5", "gpt-5.5-codex", "o3", "o4-mini"];
  }
  if (provider === "anthropic") {
    return ["claude-sonnet-4", "claude-opus-4", "claude-haiku-3.5", "claude-sonnet-3.5"];
  }
  return [];
}

async function autoDetectDefaultProvider(): Promise<string | null> {
  const hasOllama = await detectOllama();
  if (hasOllama) return "ollama";
  return null;
}

/* ── Launch modes ────────────────────────────────────────────── */

async function cmdChat(modelName?: string): Promise<void> {
  const cfg = getConfig();
  connect(cfg.DB_PATH);
  pushSchema();
  note(`Model: ${modelName ?? cfg.ARELY_MODEL}`, "ARELY Chat");
  console.log("Type your message or /quit to exit.\n");

  const { SessionManager } = await import("./server/session-manager.js");
  const { SSEBus } = await import("./server/sse.js");
  const { ModelRegistry } = await import("./models/model-registry.js");
  const { ModelAwareAdapter } = await import("./models/model-adapter.js");

  const sse = new SSEBus();
  const modelRegistry = new ModelRegistry(cfg.ARELY_MODELS, cfg.ARELY_DEFAULT_MODEL);
  const llm = new ModelAwareAdapter(modelRegistry, cfg.ARELY_API_KEY);
  const sm = new SessionManager();

  const i = rl();
  async function ask(): Promise<void> {
    i.question("\n> ", async (line) => {
      const msg = line.trim();
      if (msg === "/quit") { i.close(); return; }
      if (!msg) { ask(); return; }
      const session = sm.createSession(sse, llm, {
        permissions: { websearch: cfg.ARELY_PERMIT_WEBSEARCH, webfetch: cfg.ARELY_PERMIT_WEBFETCH },
        searchProvider: cfg.ARELY_WEBSEARCH_PROVIDER,
        model: modelName ?? cfg.ARELY_MODEL,
        modelId: modelName ?? cfg.ARELY_MODEL,
        toolMode: cfg.ARELY_TOOL_MODE,
        mode: "agent",
      });
      await session.run(msg);
      const lastMsg = session.messages.filter((m) => m.role === "assistant").pop();
      if (lastMsg) console.log(`\n${lastMsg.content}`);
      ask();
    });
  }
  ask();
  await new Promise<void>((resolve) => i.on("close", resolve));
}

async function cmdAgent(modelName?: string): Promise<void> {
  const cfg = getConfig();
  connect(cfg.DB_PATH);
  pushSchema();
  note(`Model: ${modelName ?? cfg.ARELY_MODEL}`, "ARELY Agent");
  console.log("Type your goal or /quit to exit.\n");

  const { SessionManager } = await import("./server/session-manager.js");
  const { SSEBus } = await import("./server/sse.js");
  const { ModelRegistry } = await import("./models/model-registry.js");
  const { ModelAwareAdapter } = await import("./models/model-adapter.js");

  const sse = new SSEBus();
  const modelRegistry = new ModelRegistry(cfg.ARELY_MODELS, cfg.ARELY_DEFAULT_MODEL);
  const llm = new ModelAwareAdapter(modelRegistry, cfg.ARELY_API_KEY);
  const sm = new SessionManager();

  const i = rl();
  async function ask(): Promise<void> {
    i.question("\nGoal> ", async (line) => {
      const msg = line.trim();
      if (msg === "/quit") { i.close(); return; }
      if (!msg) { ask(); return; }
      const session = sm.createSession(sse, llm, {
        permissions: { websearch: cfg.ARELY_PERMIT_WEBSEARCH, webfetch: cfg.ARELY_PERMIT_WEBFETCH },
        searchProvider: cfg.ARELY_WEBSEARCH_PROVIDER,
        model: modelName ?? cfg.ARELY_MODEL,
        modelId: modelName ?? cfg.ARELY_MODEL,
        toolMode: cfg.ARELY_TOOL_MODE,
        mode: "agent",
      });
      await session.run(msg);
      const lastMsg = session.messages.filter((m) => m.role === "assistant").pop();
      if (lastMsg) console.log(`\n${lastMsg.content}`);
      ask();
    });
  }
  ask();
  await new Promise<void>((resolve) => i.on("close", resolve));
}

async function cmdServer(): Promise<void> {
  const cfg = getConfig();
  if (!cfg.ARELY_API_KEY && cfg.ARELY_PROVIDER === "openai") {
    log.warn("ARELY_API_KEY not set. LLM calls may fail for OpenAI.");
  }
  note(`Server starting on port ${cfg.PORT}`, "ARELY Server");
  const { main } = await import("./index.js");
  main();
}

/* ── Subcommands ─────────────────────────────────────────────── */

async function cmdDoctor(): Promise<void> {
  const cfg = getConfig();
  const userCfg = loadUserConfig();
  const s = spinner();
  s.start("Running diagnostics...");

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  checks.push({
    name: "API Key",
    ok: Boolean(cfg.ARELY_API_KEY),
    detail: cfg.ARELY_API_KEY ? `Set (${cfg.ARELY_API_KEY.slice(0, 8)}...)` : "Not set (local providers may skip)",
  });
  checks.push({ name: "Provider", ok: true, detail: userCfg.defaultProvider || cfg.ARELY_PROVIDER });
  checks.push({ name: "Default Model", ok: true, detail: userCfg.defaultModel || cfg.ARELY_MODEL || "(none)" });
  checks.push({ name: "Enabled Models", ok: true, detail: String(userCfg.enabledModels.length) });
  checks.push({ name: "Mode", ok: true, detail: userCfg.mode });
  checks.push({ name: "Config File", ok: true, detail: "~/.arely/config.json" });

  try {
    const ollamaOk = await detectOllama();
    checks.push({
      name: "Ollama (localhost:11434)",
      ok: ollamaOk,
      detail: ollamaOk ? "Responding" : "Not detected",
    });
  } catch {
    checks.push({ name: "Ollama (localhost:11434)", ok: false, detail: "Check failed" });
  }

  s.stop("Diagnostics complete");

  const maxName = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    const status = c.ok ? green("\u2713") : red("\u2717");
    console.log(`  ${status} ${c.name.padEnd(maxName + 2)}${c.detail}`);
  }

  const critical = checks.filter((c) => c.name !== "API Key" && !c.ok);
  if (critical.length > 0) {
    outro(red("Some checks failed. Review the details above."));
  } else {
    outro(green("All checks passed."));
  }
}

async function cmdModelsList(): Promise<void> {
  intro("ARELY Models");
  const userCfg = loadUserConfig();

  if (userCfg.enabledModels.length > 0) {
    note(
      userCfg.enabledModels
        .map((m) => (m === userCfg.defaultModel ? `  ${green("\u2713")} ${m} ${dim("(default)")}` : `  ${green("\u2713")} ${m}`))
        .join("\n"),
      "Enabled Models",
    );
  } else {
    log.info("No models enabled");
  }

  const ollamaModels = await fetchOllamaModelDefs();
  if (ollamaModels.length > 0) {
    const notEnabled = ollamaModels.filter((m) => !userCfg.enabledModels.includes(m.name));
    if (notEnabled.length > 0) {
      note(notEnabled.map((m) => `  - ${m.name}`).join("\n"), "Detected (not enabled)");
    }
  }
  outro("Done");
}

async function cmdModelUse(modelName: string): Promise<void> {
  setDefaultModel(modelName);
  setEnv("ARELY_MODEL", modelName);
  loadConfig();
  outro(green(`Default model set to ${modelName}`));
}

async function cmdModelRecommend(taskType?: string): Promise<void> {
  if (taskType) {
    const rec = modelPerformanceService.recommendModel(taskType);
    if (rec) {
      note(rec, `Recommended for ${taskType}`);
    } else {
      log.info(`No data yet for ${taskType}. Run some sessions first.`);
    }
    return;
  }

  const all = modelPerformanceService.getAllRecommendations();
  if (all.length > 0) {
    note(all.join("\n"), "Recommendations");
  } else {
    log.info("No recommendations yet. Run some sessions to gather data.");
  }
}

async function cmdModelAdd(): Promise<void> {
  const ollamaModels = await fetchOllamaModelDefs();
  if (ollamaModels.length === 0) {
    log.error("No Ollama models detected. Is Ollama running?");
    return;
  }
  const userCfg = loadUserConfig();
  const newModels = ollamaModels.filter((m) => !userCfg.enabledModels.includes(m.name));
  if (newModels.length === 0) {
    log.info("All detected Ollama models are already enabled");
    return;
  }
  note(newModels.map((m) => `  ${m.name}`).join("\n"), "Detected");
  const ok = await p.confirm({ message: "Add all?" });
  if (isCancel(ok)) return;
  if (ok) {
    for (const m of newModels) toggleModel(m.name, true);
    if (!userCfg.defaultModel && newModels.length > 0) setDefaultModel(newModels[0].name, "ollama");
    outro(green(`Added ${newModels.length} model(s).`));
  }
}

/* ── Interactive model management ─────────────────────────────── */

async function modelSelector(provider: string): Promise<string> {
  const models = await detectModelsForProvider(provider);
  if (models.length === 0) {
    log.warn(`No models detected for ${provider}.`);
    return "";
  }
  const userCfg = loadUserConfig();
  const chosen = await p.select({
    message: `Select a model (${provider}):`,
    options: models.map((m) => ({
      value: m,
      label: userCfg.enabledModels.includes(m) ? `${m} ${dim("(enabled)")}` : m,
    })),
  });
  if (isCancel(chosen)) return "";
  return chosen as string;
}

/* ── Settings ─────────────────────────────────────────────────── */

async function settingsFlow(): Promise<void> {
  const userCfg = loadUserConfig();
  while (true) {
    const action = await p.select({
      message: "Settings",
      options: [
        { value: "provider", label: `Change provider (${cyan(userCfg.defaultProvider)})` },
        { value: "model", label: `Change model${userCfg.defaultModel ? " (" + cyan(userCfg.defaultModel) + ")" : ""}` },
        { value: "mode", label: `Change mode (${cyan(userCfg.mode)})` },
        { value: "back", label: "Back" },
      ],
    });
    if (isCancel(action) || action === "back") break;

    if (action === "provider") {
      const prov = await p.select({
        message: "Select provider:",
        options: ALL_PROVIDERS.map((pr) => ({
          value: pr,
          label: pr === userCfg.defaultProvider ? `${pr} ${dim("(current)")}` : pr,
        })),
      });
      if (isCancel(prov)) continue;
      userCfg.defaultProvider = prov;
      saveUserConfig(userCfg);
      setEnv("ARELY_PROVIDER", prov);
      outro(green(`Provider set to ${prov}`));
    }

    if (action === "model") {
      const prov = userCfg.defaultProvider;
      const chosen = await modelSelector(prov);
      if (!chosen) continue;
      setDefaultModel(chosen);
      const updated = loadUserConfig();
      userCfg.defaultModel = updated.defaultModel;
      setEnv("ARELY_MODEL", updated.defaultModel);
      outro(green(`Model set to ${chosen}`));
    }

    if (action === "mode") {
      const mode = await p.select({
        message: "Select mode:",
        options: [
          { value: "chat", label: "Chat" },
          { value: "agent", label: "Agent" },
          { value: "server", label: "API Server" },
        ].map((m) => ({
          ...m,
          label: m.value === userCfg.mode ? `${m.label} ${dim("(current)")}` : m.label,
        })),
      });
      if (isCancel(mode)) continue;
      userCfg.mode = mode as UserConfig["mode"];
      saveUserConfig(userCfg);
      outro(green(`Mode set to ${mode}`));
    }
  }
}

/* ── Interactive main ────────────────────────────────────────── */

function statusLine(cfg: UserConfig): string {
  const parts: string[] = [];
  if (cfg.defaultProvider) parts.push(`Provider: ${cyan(cfg.defaultProvider)}`);
  if (cfg.defaultModel) parts.push(`Model: ${cyan(cfg.defaultModel)}`);
  parts.push(`Mode: ${cyan(cfg.mode)}`);
  return parts.join("  ·  ");
}

async function firstRunWizard(): Promise<UserConfig | null> {
  renderBrand();
  intro(bold("Welcome to ARELY"));

  const detectedProvider = await autoDetectDefaultProvider();
  let provider = detectedProvider ?? (await p.select({
    message: "Choose a provider:",
    options: [
      { value: "ollama", label: "Ollama", hint: "Local (recommended)" },
      { value: "openai", label: "OpenAI" },
      { value: "anthropic", label: "Anthropic" },
      { value: "lmstudio", label: "LM Studio", hint: "Local" },
      { value: "local", label: "Local" },
    ],
  }));
  if (isCancel(provider)) { cancel("Setup cancelled"); return null; }

  const models = await detectModelsForProvider(provider);
  let model: string;
  if (models.length > 0) {
    const chosen = await p.select({
      message: "Select model:",
      options: models.map((m) => ({ value: m, label: m })),
    });
    if (isCancel(chosen)) { cancel("Setup cancelled"); return null; }
    model = chosen as string;
  } else {
    const entered = await p.text({ message: "Model name:", defaultValue: "gpt-4o" });
    if (isCancel(entered)) { cancel("Setup cancelled"); return null; }
    model = entered as string;
  }

  const mode = await p.select({
    message: "Select mode:",
    options: [
      { value: "chat", label: "Chat" },
      { value: "agent", label: "Agent" },
      { value: "server", label: "API Server" },
    ],
  });
  if (isCancel(mode)) { cancel("Setup cancelled"); return null; }

  const cfg: UserConfig = {
    defaultProvider: provider,
    defaultModel: model,
    enabledModels: [model],
    mode: mode as UserConfig["mode"],
  };
  saveUserConfig(cfg);

  outro(green("Configuration saved to ~/.arely/config.json"));
  return cfg;
}

async function interactiveMain(): Promise<void> {
  let userCfg = loadUserConfig();

  if (!userCfg.defaultModel) {
    const result = await firstRunWizard();
    if (!result) { process.exit(0); }
    userCfg = result;
  }

  while (true) {
    renderBrand();
    note(statusLine(userCfg), "Status");

    /* Show model recommendations if data exists */
    const recommendations = modelPerformanceService.getAllRecommendations();
    if (recommendations.length > 0) {
      const lines = recommendations.slice(0, 4);
      if (recommendations.length > 4) lines.push(`  ... and ${recommendations.length - 4} more`);
      note(lines.join("\n"), "Recommendations");
    }

    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "chat", label: "Start Chat" },
        { value: "agent", label: "Start Agent" },
        { value: "server", label: "Start Server" },
        { value: "models", label: "Manage Models" },
        { value: "settings", label: "Settings" },
        { value: "doctor", label: "Doctor" },
        { value: "exit", label: "Exit" },
      ],
    });
    if (isCancel(action) || action === "exit") {
      outro("Goodbye.");
      process.exit(0);
    }

    setEnv("ARELY_PROVIDER", userCfg.defaultProvider);
    if (userCfg.defaultModel) setEnv("ARELY_MODEL", userCfg.defaultModel);
    loadConfig();

    if (action === "chat") {
      await cmdChat(userCfg.defaultModel || undefined);
      continue;
    }
    if (action === "agent") {
      await cmdAgent(userCfg.defaultModel || undefined);
      continue;
    }
    if (action === "server") {
      await cmdServer();
      continue;
    }
    if (action === "models") {
      await interactiveManageModels();
      userCfg = loadUserConfig();
      continue;
    }
    if (action === "settings") {
      await settingsFlow();
      userCfg = loadUserConfig();
      continue;
    }
    if (action === "doctor") {
      await cmdDoctor();
      const cont = await p.confirm({ message: "Back to menu?" });
      if (isCancel(cont) || !cont) { outro("Goodbye."); process.exit(0); }
      continue;
    }
  }
}

async function interactiveManageModels(): Promise<void> {
  const userCfg = loadUserConfig();
  const allModels = await detectModelsForProvider(userCfg.defaultProvider);

  while (true) {
    const enabledList = userCfg.enabledModels;
    const actions: { value: string; label: string }[] = [];

    if (allModels.length > 0) {
      actions.push({ value: "toggle", label: "Enable / Disable models" });
    }
    actions.push({ value: "add", label: "Add models from Ollama" });
    actions.push({ value: "set-default", label: "Set default model" });
    actions.push({ value: "back", label: "Back" });

    const action = await p.select({
      message: `Manage Models (${enabledList.length} enabled)`,
      options: actions,
    });
    if (isCancel(action) || action === "back") break;

    if (action === "toggle") {
      const selected = await p.multiselect({
        message: "Toggle models:",
        options: allModels.map((m) => ({
          value: m,
          label: m,
          checked: enabledList.includes(m),
        })),
        required: false,
      });
      if (isCancel(selected)) continue;
      const chosen = selected as string[];
      for (const m of allModels) {
        toggleModel(m, chosen.includes(m));
      }
      const updated = loadUserConfig();
      userCfg.enabledModels = updated.enabledModels;
      userCfg.defaultModel = updated.defaultModel;
      outro(green(`Models updated: ${chosen.length} enabled`));
    }

    if (action === "add") {
      const freshModels = await fetchOllamaModelDefs();
      const newOnes = freshModels.filter((m) => !userCfg.enabledModels.includes(m.name));
      if (newOnes.length === 0) {
        log.info("No new models detected");
        continue;
      }
      const toAdd = await p.multiselect({
        message: "Select models to add:",
        options: newOnes.map((m) => ({ value: m.name, label: m.name })),
      });
      if (isCancel(toAdd) || (toAdd as string[]).length === 0) continue;
      for (const m of toAdd as string[]) toggleModel(m, true);
      const updated2 = loadUserConfig();
      userCfg.enabledModels = updated2.enabledModels;
      outro(green(`Added ${(toAdd as string[]).length} model(s).`));
    }

    if (action === "set-default") {
      if (userCfg.enabledModels.length === 0) {
        log.error("No enabled models. Enable models first.");
        continue;
      }
      const chosen = await p.select({
        message: "Select default model:",
        options: userCfg.enabledModels.map((m) => ({
          value: m,
          label: m === userCfg.defaultModel ? `${m} ${dim("(current)")}` : m,
        })),
      });
      if (isCancel(chosen)) continue;
      setDefaultModel(chosen as string);
      userCfg.defaultModel = chosen as string;
      outro(green(`Default model set to ${chosen}`));
    }
  }
}

/* ── Entry point ─────────────────────────────────────────────── */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "server") { loadConfig(); await cmdServer(); return; }
  if (command === "doctor") { loadConfig(); await cmdDoctor(); return; }
  if (command === "chat") { loadConfig(); await cmdChat(args[1]); return; }
  if (command === "agent") { loadConfig(); await cmdAgent(args[1]); return; }
  if (command === "models") { loadConfig(); await cmdModelsList(); return; }
  if (command === "model" && args[1] === "use") {
    if (!args[2]) { log.error("Usage: arely model use <model-name>"); process.exit(1); }
    loadConfig();
    await cmdModelUse(args[2]);
    return;
  }
  if (command === "model" && args[1] === "add") {
    loadConfig();
    await cmdModelAdd();
    return;
  }

  if (command === "model" && args[1] === "recommend") {
    loadConfig();
    await cmdModelRecommend(args[2]);
    return;
  }

  await interactiveMain();
}

main().catch((err) => {
  console.error("CLI error:", err);
  process.exit(1);
});
