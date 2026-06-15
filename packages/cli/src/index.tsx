#!/usr/bin/env node

import { render } from "ink";
import React from "react";
import { bootEngine, connectToServer } from "./engine.js";
import { App } from "./app.js";
import type { EngineContext } from "./engine.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  arely — AgentOS Terminal UI

  Usage:
    arely                  Start TUI (boots engine in-process)
    arely --connect <url>  Connect to a remote server
    arely --help           Show this help
    arely --version        Show version
`);
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    const pkg = await import("../package.json", { with: { type: "json" } });
    console.log(pkg.default?.version ?? "0.1.0");
    process.exit(0);
  }

  let engine: EngineContext | undefined;

  const connectIdx = args.indexOf("--connect");
  if (connectIdx >= 0 && args[connectIdx + 1]) {
    engine = await connectToServer(args[connectIdx + 1]);
  } else {
    engine = await bootEngine();
  }

  render(React.createElement(App, { engine }));
}

main().catch((err) => {
  console.error("CLI error:", err);
  process.exit(1);
});
