"use client";

import React from "react";
import { appStore } from "@arelyos/ui-core/stores/app-store";
import { uiStore } from "@arelyos/ui-core/stores/ui-store";
import { sessionStore } from "@arelyos/ui-core/stores/session-store";
import { useEngine } from "../hooks/useEngine";
import { Sidebar } from "../components/Sidebar";
import { ChatWindow } from "../components/ChatWindow";
import { StatusBar } from "../components/StatusBar";
import { CommandPalette } from "../components/CommandPalette";
import { DashboardOverlay } from "../components/DashboardOverlay";
import { GoalsPanel } from "../components/GoalsPanel";
import { SwarmPanel } from "../components/SwarmPanel";

export default function Home() {
  const [, forceUpdate] = React.useState(0);
  const { send, cancel, healthCheck, error } = useEngine();

  React.useEffect(() => { healthCheck(); }, [healthCheck]);

  React.useEffect(() => {
    const u1 = appStore.subscribe(() => forceUpdate((n) => n + 1));
    const u2 = uiStore.subscribe(() => forceUpdate((n) => n + 1));
    const u3 = sessionStore.subscribe(() => forceUpdate((n) => n + 1));
    return () => { u1(); u2(); u3(); };
  }, []);

  const { sidebarOpen, paletteOpen, dashboardOpen, goalsOpen, swarmOpen } = uiStore.getState();
  const { username, model, provider, isEngineRunning } = appStore.getState();
  const { sessionState, permissionRequest } = sessionStore.getState();

  const [mode, setMode] = React.useState<"home" | "chat">("home");

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && mode === "home") { setMode("chat"); return; }
      if ((e.key === "p" || e.key === "P") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        uiStore.setState({ paletteOpen: !uiStore.getState().paletteOpen });
      }
      if (e.key === "Escape") { uiStore.setState({ goalsOpen: false, swarmOpen: false, paletteOpen: false }); }
      if ((e.key === "w" || e.key === "W") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        uiStore.setState({ swarmOpen: !uiStore.getState().swarmOpen });
      }
      if ((e.key === "g" || e.key === "G") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        uiStore.setState({ goalsOpen: !uiStore.getState().goalsOpen });
      }
      if ((e.key === "d" || e.key === "D") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        uiStore.setState({ dashboardOpen: !uiStore.getState().dashboardOpen });
      }
      if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        uiStore.setState({ sidebarOpen: !uiStore.getState().sidebarOpen });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode]);

  if (mode === "home") {
    return (
      <div className="home">
        <div className="home-card">
          <div className="home-title">ARELY v0.1.0</div>
          <p className="home-subtitle">Bienvenido, {username}</p>
          <p className="home-hint">
            {isEngineRunning ? "> Ask anything..." : "Engine offline — start the server"}
          </p>
          <button className="home-btn" onClick={() => setMode("chat")}>Enter Chat</button>
          <p className="home-shortcuts">
            Tab agents · Ctrl+K models · Ctrl+P palette · Ctrl+D dashboard
          </p>
          <p style={{ color: "#555", fontSize: 12, marginTop: 4 }}>
            {appStore.getState().agentMode.charAt(0).toUpperCase() + appStore.getState().agentMode.slice(1)} · {model || "qwen2.5:3b"} · {provider || "ollama"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="header">
        <div className="header-left">
          <span className="header-dot online" />
          <span style={{ color: "#00ff88", fontWeight: "bold" }}>ARELY</span>
          <span style={{ color: "#555", fontSize: 12 }}>v0.1.0</span>
        </div>
        <div className="header-right">
          <span className="text-muted">{model || "qwen2.5:3b"}</span>
          <span style={{ color: "#444" }}>·</span>
          <span className="text-muted">{provider || "ollama"}</span>
          {sessionState === "running" && <span style={{ color: "#00ff88" }}>RUNNING</span>}
          <span style={{ color: "#444", fontSize: 11, cursor: "pointer" }} onClick={() => { uiStore.setState({ sidebarOpen: !sidebarOpen }); }}>
            [<u>{sidebarOpen ? "hide" : "show"}</u>]
          </span>
        </div>
      </header>

      <div className="app-main">
        <Sidebar />
        <div className="app-content">
          <div className="app-chat">
            <ChatWindow />
          </div>
          <Prompt onSend={send} onCancel={cancel} sessionState={sessionState} error={error} />
        </div>
      </div>

      <StatusBar />
      {paletteOpen && <CommandPalette />}
      {permissionRequest && <PermissionOverlay request={permissionRequest} />}
      {dashboardOpen && <DashboardOverlay />}
      {goalsOpen && (
        <div className="overlay" onClick={() => uiStore.setState({ goalsOpen: false })}>
          <div className="overlay-panel" style={{ minWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <GoalsPanel />
          </div>
        </div>
      )}
      {swarmOpen && <SwarmPanel />}
    </div>
  );
}

function Prompt({ onSend, onCancel, sessionState, error }: { onSend: (t: string) => void; onCancel: () => void; sessionState: string; error?: string | null }) {
  const [value, setValue] = React.useState("");
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    ref.current?.focus();
  }, [sessionState]);

  const handleSubmit = () => {
    if (!value.trim() || sessionState === "running") return;
    onSend(value.trim());
    setValue("");
  };

  if (sessionState === "running") {
    return (
      <div className="prompt-running">
        <span style={{ color: "#00ff88" }}>&gt;</span>
        <span>Running...</span>
        <button className="prompt-cancel" onClick={onCancel}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="prompt">
      <span style={{ color: "#00ff88" }}>&gt;</span>
      <input ref={ref} value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
        className="prompt-input"
        placeholder="Ask anything..."
      />
      {error && <span style={{ color: "#ff4444", fontSize: 12, marginLeft: "auto" }}>Error: {error}</span>}
    </div>
  );
}

function PermissionOverlay({ request }: { request: { id: string; tool: string; args: Record<string, unknown> } }) {
  const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL || "http://localhost:8081";
  const desc = request.args.query
    ? `"${String(request.args.query).slice(0, 80)}"`
    : request.args.url
      ? String(request.args.url).slice(0, 80)
      : "";

  return (
    <div className="overlay">
      <div className="overlay-panel" style={{ minWidth: 400 }}>
        <div style={{ color: "#ffcc00", fontSize: 16, marginBottom: 12 }}>Permission Required</div>
        <div style={{ color: "#888", marginBottom: 8 }}>
          Tool: <strong style={{ color: "#ccc" }}>{request.tool}</strong>
        </div>
        {desc && <div style={{ color: "#666", fontSize: 13, marginBottom: 16 }}>{desc}</div>}
        <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => fetch(`${ENGINE_URL}/api/permissions/${request.id}/deny`, { method: "POST" }).catch(() => {})}>
            Deny
          </button>
          <button className="btn-primary" style={{ padding: "4px 16px" }}
            onClick={() => fetch(`${ENGINE_URL}/api/permissions/${request.id}/approve`, { method: "POST" }).catch(() => {})}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
