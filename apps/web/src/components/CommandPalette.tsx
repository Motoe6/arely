"use client";

import React from "react";
import { uiStore } from "@arelyos/ui-core/stores/ui-store";

const COMMANDS = [
  { id: "new", label: "New Session", key: "" },
  { id: "model", label: "Switch Model", key: "ctrl+k" },
  { id: "swarm", label: "Toggle Swarm", key: "tab" },
  { id: "goals", label: "Create Goal", key: "ctrl+g" },
  { id: "benchmark", label: "Run Benchmark", key: "" },
  { id: "sidebar", label: "Toggle Sidebar", key: "ctrl+s" },
  { id: "dashboard", label: "Toggle Dashboard", key: "ctrl+d" },
  { id: "settings", label: "Settings", key: "" },
];

export function CommandPalette() {
  const [cursor, setCursor] = React.useState(0);
  const [filter, setFilter] = React.useState("");
  const filtered = COMMANDS.filter((c) => c.label.toLowerCase().includes(filter.toLowerCase()));

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { uiStore.setState({ paletteOpen: false }); return; }
      if (e.key === "Enter" && filtered[cursor]) {
        const cmd = filtered[cursor].id;
        if (cmd === "sidebar") { const s = uiStore.getState(); uiStore.setState({ sidebarOpen: !s.sidebarOpen, paletteOpen: false }); }
        if (cmd === "dashboard") { const s = uiStore.getState(); uiStore.setState({ dashboardOpen: !s.dashboardOpen, paletteOpen: false }); }
        uiStore.setState({ paletteOpen: false });
        return;
      }
      if (e.key === "ArrowUp") { setCursor((p) => Math.max(0, p - 1)); return; }
      if (e.key === "ArrowDown") { setCursor((p) => Math.min(filtered.length - 1, p + 1)); return; }
      if (e.key === "Backspace") { setFilter((p) => p.slice(0, -1)); setCursor(0); return; }
      if (e.key.length === 1) { setFilter((p) => p + e.key); setCursor(0); return; }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cursor, filtered]);

  return (
    <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 400, background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 1000 }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #222" }}>
        <span style={{ color: "#00ff88" }}>&gt;</span>{" "}
        <input value={filter} onChange={(e) => { setFilter(e.target.value); setCursor(0); }}
          autoFocus style={{ background: "transparent", border: "none", color: "#e0e0e0", outline: "none", width: "90%", fontFamily: "inherit" }}
          placeholder="Command Palette"
        />
      </div>
      <div style={{ padding: "4px 0" }}>
        {filtered.map((cmd, i) => (
          <div key={cmd.id} style={{ padding: "4px 12px", display: "flex", justifyContent: "space-between", background: i === cursor ? "#222" : "transparent" }}>
            <span style={{ color: i === cursor ? "#00ff88" : "#ccc" }}>{cmd.label}</span>
            {cmd.key && <span style={{ color: "#555", fontSize: 12 }}>{cmd.key}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}