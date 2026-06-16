#!/usr/bin/env node

const HELP = `
  arely — AgentOS for Autonomous Work

  Usage:
    arely                  Start Terminal UI (boots engine in-process)
    arely serve            Start HTTP engine server
    arely web              Start Next.js web UI
    arely init             Interactive setup wizard
    arely config           View current configuration
    arely login            Authentication setup
    arely update           Check for updates
    arely doctor           Verify system installation
    arely bench            Run benchmarks
    arely models           List installed models
    arely models --health  Check provider connectivity (--json for JSON)
    arely version          Show version

  Options:
    --connect <url>        Connect TUI to a remote server
    --port <port>          Port for serve (default: 8081)
    --help, -h             Show this help
    --version, -v          Show version

  Examples:
    arely
    arely init
    arely config
    arely serve
    arely serve --port 3000
    arely web
    arely doctor
    arely --connect http://localhost:8081
`;

async function exec(cmd: string): Promise<string> {
  const { execSync } = await import("node:child_process");
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd.startsWith("-")) {
    if (cmd === "--help" || cmd === "-h") { console.log(HELP); process.exit(0); }
    if (cmd === "--version" || cmd === "-v") { await showVersion(); return; }
    if (cmd === "--connect" && args[1]) { await startTUI(args[1]); return; }
    if (cmd === "--port" && args[1]) { await startServe(Number(args[1])); return; }
    if (cmd?.startsWith("--")) { console.log(`Unknown flag: ${cmd}\n${HELP}`); process.exit(1); }
    await startTUI();
    return;
  }

  switch (cmd) {
    case "serve": await startServe(parsePort(args[1])); break;
    case "web": await startWeb(); break;
    case "doctor": await doctor(); break;
    case "bench": await bench(); break;
    case "models": await models(); break;
    case "version": await showVersion(); break;
    case "init": await initCmd(); break;
    case "config": await configCmd(); break;
    case "login": await loginCmd(); break;
    case "update": await updateCmd(); break;
    default:
      if (args.includes("--connect")) {
        const idx = args.indexOf("--connect");
        await startTUI(args[idx + 1] || "");
      } else {
        console.log(`Unknown command: ${cmd}\n${HELP}`);
        process.exit(1);
      }
  }
}

function parsePort(arg?: string): number {
  if (arg && !isNaN(Number(arg))) return Number(arg);
  return 8081;
}

async function startTUI(connectUrl?: string) {
  const { render } = await import("ink");
  const React = await import("react");
  const { bootEngine, connectToServer } = await import("./engine.js");
  const { App } = await import("./app.js");

  let engine;
  if (connectUrl) {
    engine = await connectToServer(connectUrl);
  } else {
    engine = await bootEngine();
  }
  render(React.createElement(App, { engine }));
}

async function startServe(port: number) {
  const picocolors = await import("picocolors");
  process.env.PORT = String(port);
  const { main } = await import("@arelyos/engine/index.js");
  main();
}

async function startWeb() {
  const { spawn } = await import("node:child_process");
  const picocolors = await import("picocolors");
  console.log(picocolors.default.cyan("Starting ARELY Web UI..."));
  console.log(picocolors.default.dim("Expected: http://localhost:3000\n"));
  const child = spawn("npm", ["run", "dev:web"], {
    stdio: "inherit",
    cwd: new URL("../..", import.meta.url).pathname,
    shell: true,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function doctor() {
  const picocolors = await import("picocolors");
  const c = picocolors.default;
  let ok = 0, fail = 0;

  const checks: [string, () => Promise<boolean>][] = [
    ["Node.js version", async () => {
      const major = parseInt(process.versions.node.split(".")[0], 10);
      return major >= 18;
    }],
    ["npm installed", async () => { try { await exec("npm --version"); return true; } catch { return false; } }],
    ["SQLite available", async () => {
      try {
        const { getDb } = await import("@arelyos/engine/persistence/database.js");
        const { loadConfig } = await import("@arelyos/engine/config/index.js");
        loadConfig();
        return getDb() !== undefined;
      } catch { return false; }
    }],
    ["Engine module loadable", async () => {
      try { await import("@arelyos/engine/index.js"); return true; } catch { return false; }
    }],
    ["Persistence layer", async () => {
      try {
        const { queryGoals } = await import("@arelyos/persistence");
        return typeof queryGoals === "function";
      } catch { return false; }
    }],
  ];

  for (const [label, fn] of checks) {
    const pass = await fn();
    console.log(pass ? `  ${c.green("✓")} ${label}` : `  ${c.red("✗")} ${label}`);
    if (pass) ok++; else fail++;
  }

  console.log(c.dim(`\n  ${ok} passed, ${fail} failed`));
  process.exit(fail > 0 ? 1 : 0);
}

async function bench() {
  const picocolors = await import("picocolors");
  const args = process.argv.slice(3);
  const realFlag = args.includes("--real") || args.includes("-r") ? "--real" : "";
  console.log(picocolors.default.cyan(`Running ARELY Benchmarks... ${realFlag ? "(REAL LLM mode)" : "(deterministic)"}\n`));
  const { spawn } = await import("node:child_process");
  const npmArgs = ["run", "bench"];
  if (realFlag) npmArgs.push("--", "--real");
  const child = spawn("npm", npmArgs, {
    stdio: "inherit",
    cwd: new URL("../..", import.meta.url).pathname,
    shell: true,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function models() {
  const picocolors = await import("picocolors");
  const c = picocolors.default;
  const args = process.argv.slice(3);
  const showHealth = args.includes("--health") || args.includes("-H");
  const jsonOutput = args.includes("--json") || args.includes("-j");

  try {
    const { loadUserConfigFile, getArelyDir } = await import("@arelyos/engine/config/io.js");
    const { KNOWN_PROVIDERS } = await import("@arelyos/engine/config/types.js");
    type KnownProvider = (typeof KNOWN_PROVIDERS)[number];
    const fs = await import("node:fs");
    const path = await import("node:path");

    if (showHealth) {
      const { loadConfig } = await import("@arelyos/engine/config/index.js");
      const { checkAllProviders } = await import("@arelyos/engine/models/health-checker.js");
      loadConfig();
      const userConfig = loadUserConfigFile();

      const enabledProviders: string[] = userConfig.providers
        ? Object.entries(userConfig.providers).filter(([_, p]) => p?.enabled).map(([k]) => k)
        : userConfig.defaultProvider ? [userConfig.defaultProvider] : [];

      if (enabledProviders.length === 0) {
        console.log(c.yellow("  No providers configured. Run `arely init` first."));
        return;
      }

      console.log(c.bold("  Provider Health\n"));
      const healthResults = await checkAllProviders();

      if (jsonOutput) {
        console.log(JSON.stringify(healthResults, null, 2));
        return;
      }

      for (const h of healthResults) {
        let icon: string;
        let statusText: string;
        switch (h.status) {
          case "online":
            icon = c.green("✓");
            statusText = c.green(`online${h.latencyMs != null ? `  ${h.latencyMs}ms` : ""}`);
            break;
          case "unauthorized":
            icon = c.red("✗");
            statusText = c.red("unauthorized");
            break;
          case "rate_limited":
            icon = c.yellow("⚠");
            statusText = c.yellow("rate limited");
            break;
          case "offline":
            icon = c.red("✗");
            statusText = c.red("offline");
            break;
          default:
            icon = c.dim("?");
            statusText = c.dim(h.status);
        }

        console.log(`  ${c.cyan(c.bold(h.label))}`);
        console.log(`    ${icon} ${statusText}`);

        if (h.modelCount != null) {
          console.log(`    ${c.dim("Models:")} ${h.modelCount}`);
        }
        if (h.models && h.models.length > 0) {
          const shown = h.models.slice(0, 5);
          for (const m of shown) {
            const marker = m === h.defaultModel ? c.yellow(" ★") : "";
            console.log(`    ${c.dim("─")} ${m}${marker}`);
          }
          if (h.models.length > 5) {
            console.log(`    ${c.dim(`  … and ${h.models.length - 5} more`)}`);
          }
        }
        if (h.error) {
          console.log(`    ${c.dim("Error:")} ${c.red(h.error)}`);
        }
        console.log("");
      }
      return;
    }

    // Non-health display
    const config = loadUserConfigFile();
    const arelyDir = getArelyDir();
    const envPath = path.join(arelyDir, ".env");

    const envApiKeys: Record<string, string> = {};
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        envApiKeys[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }

    const providerLabels: Record<string, string> = {
      openai: "OpenAI", anthropic: "Anthropic", openrouter: "OpenRouter",
      ollama: "Ollama", lmstudio: "LM Studio",
    };

    const providerDefaults: Record<string, { baseUrl: string; defaultModel: string }> = {
      openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
      anthropic: { baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4" },
      openrouter: { baseUrl: "https://openrouter.ai/api/v1", defaultModel: "deepseek/deepseek-v4-flash:free" },
      ollama: { baseUrl: "http://localhost:11434", defaultModel: "qwen2.5:3b" },
      lmstudio: { baseUrl: "http://localhost:1234/v1", defaultModel: "local-model" },
    };

    const modelSuggestions: Record<string, string[]> = {
      openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
      anthropic: ["claude-sonnet-4", "claude-haiku-3-5", "claude-opus-4"],
      openrouter: ["deepseek/deepseek-v4-flash:free", "meta-llama/llama-3.3-70b", "openai/gpt-4o-mini", "anthropic/claude-sonnet-4"],
      ollama: ["qwen2.5:3b", "qwen2.5:7b", "llama3.3", "llama3.2:3b", "deepseek-r1:8b"],
      lmstudio: ["local-model"],
    };

    const enabledProviders: KnownProvider[] = config.providers
      ? (Object.entries(config.providers).filter(([_, p]) => p?.enabled).map(([k]) => k) as KnownProvider[])
      : config.defaultProvider && KNOWN_PROVIDERS.includes(config.defaultProvider as KnownProvider)
        ? [config.defaultProvider as KnownProvider] : [];

    if (enabledProviders.length === 0) {
      console.log(c.yellow("  No providers configured. Run `arely init` first."));
      process.exit(0);
    }

    console.log(c.bold("  Available Models\n"));

    for (const provider of enabledProviders) {
      const pCfg = config.providers?.[provider];
      const label = providerLabels[provider] ?? provider;
      const defaults = providerDefaults[provider];
      const isRemote = provider !== "ollama" && provider !== "lmstudio";

      const apiKey = pCfg?.apiKey || envApiKeys[`${provider.toUpperCase()}_API_KEY`];
      const baseUrl = pCfg?.baseUrl || defaults?.baseUrl || "—";

      const hasApiKey = !isRemote || (apiKey && apiKey.length > 0);
      const statusIcon = hasApiKey ? c.green("✓") : c.red("✗");
      const statusText = hasApiKey ? c.green("reachable") : c.red("missing API key");

      console.log(`  ${c.cyan(c.bold(label))}  ${statusIcon} ${statusText}`);
      console.log(`    ${c.dim("Base URL:")} ${baseUrl}`);

      const models = modelSuggestions[provider] ?? [];
      const defaultModel = pCfg?.defaultModel || defaults?.defaultModel;

      for (const m of models) {
        const marker = m === defaultModel ? c.yellow(" ★") : "  ";
        console.log(`    ${c.dim("─")} ${m}${marker}`);
      }
      console.log("");
    }

    console.log(c.dim("  ★ = default model"));
  } catch (err) {
    console.log(c.red("  Could not load models."));
    if (err instanceof Error) console.log(c.dim(`  ${err.message}`));
    process.exit(1);
  }
}

async function showVersion() {
  try {
    const pkg = await import("../package.json", { with: { type: "json" } });
    console.log(pkg.default?.version ?? "0.1.0");
  } catch {
    console.log("0.1.0");
  }
}

// ---- CLI Commands ----

async function initCmd() {
  const { intro, outro, select, text, confirm, isCancel, note, log } = await import("@clack/prompts");
  const { getArelyDir, getDotEnvPath, saveUserConfigFile } = await import("@arelyos/engine/config/io.js");
  const picocolors = await import("picocolors");
  const fs = await import("node:fs");
  const path = await import("node:path");

  intro(picocolors.default.cyan("ARELY Setup — Multi-Provider"));

  const arelyDir = getArelyDir();
  const configPath = path.join(arelyDir, "config.json");
  if (fs.existsSync(configPath)) {
    const overwrite = await confirm({ message: "Config already exists. Overwrite?" });
    if (isCancel(overwrite) || !overwrite) {
      outro("Cancelled.");
      return;
    }
  }

  const KNOWN_PROVIDERS = ["openai", "anthropic", "openrouter", "ollama", "lmstudio"];

  const providerLabels: Record<string, { label: string; hint: string }> = {
    openai: { label: "OpenAI", hint: "gpt-4o, gpt-4o-mini" },
    anthropic: { label: "Anthropic", hint: "claude-sonnet-4, claude-haiku-3-5" },
    openrouter: { label: "OpenRouter", hint: "multi-provider gateway" },
    ollama: { label: "Ollama", hint: "local, open-source" },
    lmstudio: { label: "LM Studio", hint: "local, GUI" },
  };

  const modelOptions: Record<string, { label: string; value: string }[]> = {
    openai: [
      { label: "gpt-4o", value: "gpt-4o" },
      { label: "gpt-4o-mini", value: "gpt-4o-mini" },
      { label: "gpt-4.1", value: "gpt-4.1" },
      { label: "gpt-4.1-mini", value: "gpt-4.1-mini" },
      { label: "o3-mini", value: "o3-mini" },
    ],
    anthropic: [
      { label: "claude-sonnet-4", value: "claude-sonnet-4" },
      { label: "claude-haiku-3-5", value: "claude-haiku-3-5" },
      { label: "claude-opus-4", value: "claude-opus-4" },
    ],
    openrouter: [
      { label: "deepseek/deepseek-v4-flash:free", value: "deepseek/deepseek-v4-flash:free" },
      { label: "meta-llama/llama-3.3-70b", value: "meta-llama/llama-3.3-70b" },
      { label: "openai/gpt-4o-mini", value: "openai/gpt-4o-mini" },
      { label: "anthropic/claude-sonnet-4", value: "anthropic/claude-sonnet-4" },
    ],
    ollama: [
      { label: "qwen2.5:3b", value: "qwen2.5:3b" },
      { label: "qwen2.5:7b", value: "qwen2.5:7b" },
      { label: "llama3.3", value: "llama3.3" },
      { label: "llama3.2:3b", value: "llama3.2:3b" },
      { label: "deepseek-r1:8b", value: "deepseek-r1:8b" },
    ],
    lmstudio: [
      { label: "local-model", value: "local-model" },
    ],
  };

  const providerDefaults: Record<string, { baseUrl: string; defaultModel: string }> = {
    openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
    anthropic: { baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4" },
    openrouter: { baseUrl: "https://openrouter.ai/api/v1", defaultModel: "deepseek/deepseek-v4-flash:free" },
    ollama: { baseUrl: "http://localhost:11434", defaultModel: "qwen2.5:3b" },
    lmstudio: { baseUrl: "http://localhost:1234/v1", defaultModel: "local-model" },
  };

  const providers: Record<string, { enabled: boolean; apiKey?: string; baseUrl?: string; defaultModel?: string }> = {};
  const envLines: string[] = [];

  for (const provider of KNOWN_PROVIDERS) {
    const pl = providerLabels[provider];
    const enabled = await confirm({ message: `Configure ${pl.label}?`, initialValue: true });
    if (isCancel(enabled)) { outro("Cancelled."); return; }
    if (!enabled) continue;

    const defaults = providerDefaults[provider];

    const isRemote = provider !== "ollama" && provider !== "lmstudio";
    let apiKey: string | undefined;
    if (isRemote) {
      const keyResult = await text({
        message: `${pl.label} API key`,
        initialValue: process.env[`${provider.toUpperCase()}_API_KEY`] || "",
        validate: (v) => (v?.length ?? 0) < 4 ? "Valid API key required" : undefined,
      });
      if (isCancel(keyResult)) { outro("Cancelled."); return; }
      apiKey = keyResult;
    }

    const model = await select({
      message: `Default model for ${pl.label}`,
      options: modelOptions[provider],
    });
    if (isCancel(model)) { outro("Cancelled."); return; }

    providers[provider] = {
      enabled: true,
      apiKey: apiKey || undefined,
      baseUrl: defaults.baseUrl,
      defaultModel: model as string,
    };

    if (apiKey && apiKey.length > 0) {
      envLines.push(`${provider.toUpperCase()}_API_KEY=${apiKey}`);
    }
  }

  const enabledProviders = Object.keys(providers);
  if (enabledProviders.length === 0) {
    log.error("At least one provider must be configured.");
    outro("Cancelled.");
    return;
  }

  const defaultProvider = await select({
    message: "Default provider",
    options: enabledProviders.map((p) => ({
      label: providerLabels[p]?.label ?? p,
      value: p,
    })),
  });
  if (isCancel(defaultProvider)) { outro("Cancelled."); return; }

  const allModelChoices: { label: string; value: string }[] = [];
  for (const p of enabledProviders) {
    for (const m of modelOptions[p]) {
      allModelChoices.push({
        label: `${providerLabels[p]?.label ?? p} — ${m.label}`,
        value: m.value,
      });
    }
  }

  const defaultModel = await select({
    message: "Default model",
    options: allModelChoices,
  });
  if (isCancel(defaultModel)) { outro("Cancelled."); return; }

  const config = {
    defaultProvider: defaultProvider as string,
    defaultModel: defaultModel as string,
    providers,
    swarmEnabled: true,
    goalResumeEnabled: true,
    benchmarksEnabled: true,
    autoRecover: true,
  };

  if (!fs.existsSync(arelyDir)) fs.mkdirSync(arelyDir, { recursive: true });

  saveUserConfigFile(config);

  const envPath = getDotEnvPath();
  if (envLines.length > 0) {
    fs.writeFileSync(envPath, envLines.join("\n") + "\n", { mode: 0o600 });
  }

  for (const db of ["goals.db", "memory.db"]) {
    const dbPath = path.join(arelyDir, db);
    if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, "");
  }

  note(configPath, "Config created");
  log.success(`Providers configured: ${enabledProviders.join(", ")}`);
  log.success(".env saved with API keys");
  log.success("goals.db created");
  log.success("memory.db created");

  outro("Ready. Run `arely` to start.");
}

async function configCmd() {
  const { loadUserConfigFile, getUserConfigPath } = await import("@arelyos/engine/config/io.js");
  const picocolors = await import("picocolors");
  const fs = await import("node:fs");

  const configPath = getUserConfigPath();
  if (!fs.existsSync(configPath)) {
    console.log(picocolors.default.yellow("No config found. Run `arely init` first."));
    return;
  }

  const config = loadUserConfigFile();
  const c = picocolors.default;

  console.log(c.cyan("ARELY Config"));
  console.log(c.dim(configPath));
  console.log("");
  console.log(`  ${c.bold("Provider:")}    ${config.defaultProvider ?? "—"}`);
  console.log(`  ${c.bold("Model:")}       ${config.defaultModel ?? "—"}`);
  console.log(`  ${c.bold("Port:")}        ${config.port ?? 8081}`);
  console.log(`  ${c.bold("Swarm:")}       ${config.swarmEnabled ? c.green("ON") : c.red("OFF")}`);
  console.log(`  ${c.bold("Goal Resume:")} ${config.goalResumeEnabled ? c.green("ON") : c.red("OFF")}`);
  console.log(`  ${c.bold("Benchmarks:")}  ${config.benchmarksEnabled ? c.green("ON") : c.red("OFF")}`);
  console.log(`  ${c.bold("Base URL:")}    ${config.baseUrl ?? "—"}`);
  console.log(`  ${c.bold("API Key:")}     ${config.apiKey ? "********" : "—"}`);
}

async function loginCmd() {
  const { intro, outro, select, isCancel, note, text, log } = await import("@clack/prompts");
  const { loadUserConfigFile, saveUserConfigFile } = await import("@arelyos/engine/config/io.js");
  const picocolors = await import("picocolors");

  intro(picocolors.default.cyan("ARELY Login"));

  const choice = await select({
    message: "Authentication method",
    options: [
      { value: "github", label: "GitHub", hint: "OAuth — not yet available" },
      { value: "api-key", label: "API Key", hint: "stored locally in config" },
      { value: "local", label: "Local only", hint: "no cloud features" },
    ],
  });
  if (isCancel(choice)) { outro("Cancelled."); return; }

  if (choice === "api-key") {
    const key = await text({ message: "Enter your API key", validate: (v) => (v?.length ?? 0) < 8 ? "Invalid key" : undefined });
    if (isCancel(key)) { outro("Cancelled."); return; }
    const cfg = loadUserConfigFile();
    cfg.apiKey = key as string;
    saveUserConfigFile(cfg);
    log.success("API key saved");
  } else if (choice === "github") {
    note("GitHub OAuth is not yet available.", "Coming soon");
  } else {
    note("Running in local-only mode.", "Local");
  }

  outro("Done.");
}

async function updateCmd() {
  const { intro, outro, confirm, isCancel, log, note } = await import("@clack/prompts");
  const picocolors = await import("picocolors");

  intro(picocolors.default.cyan("ARELY Update Check"));

  let current: string;
  try {
    const pkg = await import("../package.json", { with: { type: "json" } });
    current = pkg.default?.version ?? "0.1.0";
  } catch {
    current = "0.1.0";
  }

  console.log(`  Current: ${picocolors.default.green(current)}`);

  let latest = current;
  try {
    const res = await fetch("https://registry.npmjs.org/@arelyos/cli/latest");
    if (res.ok) {
      const data = await res.json() as { version?: string };
      latest = data.version ?? current;
    }
  } catch {
    log.warn("Could not check npm registry");
  }

  if (latest === current) {
    log.success(`You're on the latest (${current})`);
    outro("Up to date.");
    return;
  }

  note(`Current: ${current}\nLatest:  ${latest}`, "Update available");

  log.info("To update:");
  console.log("  npm update -g @arelyos/cli");

  outro("Done.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});