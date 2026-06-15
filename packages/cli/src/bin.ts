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
  try {
    const { loadConfig } = await import("@arelyos/engine/config/index.js");
    const { ModelRegistry } = await import("@arelyos/engine/models/model-registry.js");
    loadConfig();
    const registry = new ModelRegistry();
    const modelList = registry.getAll();
    if (modelList.length === 0) {
      console.log("  No models installed. Configure via ARELY_MODELS env.");
      process.exit(0);
    }
    console.log("  Installed Models\n");
    for (const m of modelList) {
      const status = m.enabled ? "●" : "○";
      console.log(`  ${status} ${m.id.padEnd(30)} ${m.provider}`);
    }
  } catch {
    console.log("  Could not load model registry.");
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
  const { loadUserConfigFile, saveUserConfigFile, getUserConfigPath } = await import("@arelyos/engine/config/io.js");
  const picocolors = await import("picocolors");
  const fs = await import("node:fs");
  const path = await import("node:path");

  intro(picocolors.default.cyan("Welcome to ARELY v1.0.0"));

  const existing = loadUserConfigFile();
  if (Object.keys(existing).length > 0) {
    const overwrite = await confirm({ message: "Config already exists. Overwrite?" });
    if (isCancel(overwrite) || !overwrite) {
      outro("Cancelled.");
      return;
    }
  }

  const provider = await select({
    message: "Preferred provider",
    options: [
      { value: "ollama", label: "Ollama", hint: "local, open-source" },
      { value: "openai", label: "OpenAI", hint: "gpt-4o, gpt-4o-mini" },
      { value: "anthropic", label: "Anthropic", hint: "claude-3.5, claude-3 opus" },
      { value: "openrouter", label: "OpenRouter", hint: "multi-provider gateway" },
    ],
  });
  if (isCancel(provider)) { outro("Cancelled."); return; }

  const modelMap: Record<string, { label: string; value: string }[]> = {
    ollama: [
      { label: "qwen2.5:3b", value: "qwen2.5:3b" },
      { label: "qwen2.5:7b", value: "qwen2.5:7b" },
      { label: "llama3.3", value: "llama3.3" },
      { label: "llama3.2:3b", value: "llama3.2:3b" },
    ],
    openai: [
      { label: "gpt-4o-mini", value: "gpt-4o-mini" },
      { label: "gpt-4o", value: "gpt-4o" },
      { label: "o3-mini", value: "o3-mini" },
    ],
    anthropic: [
      { label: "claude-3.5-sonnet", value: "claude-3.5-sonnet" },
      { label: "claude-3-opus", value: "claude-3-opus" },
      { label: "claude-3-haiku", value: "claude-3-haiku" },
    ],
    openrouter: [
      { label: "openai/gpt-4o-mini", value: "openai/gpt-4o-mini" },
      { label: "anthropic/claude-3.5-sonnet", value: "anthropic/claude-3.5-sonnet" },
      { label: "meta-llama/llama-3.3-70b", value: "meta-llama/llama-3.3-70b" },
    ],
  };

  const model = await select({
    message: "Default model",
    options: modelMap[provider as string] ?? modelMap.ollama,
  });
  if (isCancel(model)) { outro("Cancelled."); return; }

  const swarmEnabled = await confirm({ message: "Enable swarm mode by default?" });
  if (isCancel(swarmEnabled)) { outro("Cancelled."); return; }

  const port = await text({ message: "Engine port", initialValue: "8081", validate: (v) => isNaN(Number(v)) ? "Must be a number" : undefined });
  if (isCancel(port)) { outro("Cancelled."); return; }

  const apiKey = await text({ message: "API key (optional)", initialValue: "" });
  if (isCancel(apiKey)) { outro("Cancelled."); return; }

  const baseUrlMap: Record<string, string> = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    ollama: "http://localhost:11434",
    openrouter: "https://openrouter.ai/api/v1",
  };

  const config = {
    defaultProvider: provider as string,
    defaultModel: model as string,
    swarmEnabled: swarmEnabled as boolean,
    port: Number(port),
    apiKey: (apiKey as string) || undefined,
    baseUrl: baseUrlMap[provider as string] ?? baseUrlMap.ollama,
    goalResumeEnabled: true,
    benchmarksEnabled: true,
    autoRecover: true,
  };

  saveUserConfigFile(config);

  const dir = path.dirname(getUserConfigPath());
  for (const db of ["goals.db", "memory.db"]) {
    const dbPath = path.join(dir, db);
    if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, "");
  }

  note(`Config: ${getUserConfigPath()}`, "Created");
  log.success("Config saved");
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