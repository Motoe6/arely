"use client";

import React from "react";
import { appStore } from "@arelyos/ui-core/stores/app-store";
import { uiStore } from "@arelyos/ui-core/stores/ui-store";
import { getAvailableModes, changeMode } from "@arelyos/ui-core/services/swarm-service";
import type { AgentMode } from "@arelyos/ui-core/types/index";

const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL || "http://localhost:8081";

const MODE_LABELS: Record<string, string> = {
  single: "Single Agent", planner: "Planner", swarm: "Swarm",
  "shared-memory": "Shared Memory", manager: "Manager",
};

export function Sidebar() {
  const [, forceUpdate] = React.useState(0);
  const [goalCount, setGoalCount] = React.useState<number | null>(null);
  const [swarmCount, setSwarmCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    const u1 = appStore.subscribe(() => forceUpdate((n) => n + 1));
    const u2 = uiStore.subscribe(() => forceUpdate((n) => n + 1));
    Promise.all([
      fetch(`${ENGINE_URL}/api/goals`).then((r) => r.json()).catch(() => ({ goals: [] })),
      fetch(`${ENGINE_URL}/api/swarms`).then((r) => r.json()).catch(() => ({ swarms: [] })),
    ]).then(([g, s]) => {
      setGoalCount(g.goals?.length ?? null);
      setSwarmCount(s.swarms?.length ?? null);
    });
    return () => { u1(); u2(); };
  }, []);

  const { agentMode, model, provider } = appStore.getState();
  const { sidebarOpen } = uiStore.getState();

  return (
    <div className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}>
      <div className="sidebar-inner">
        <Section title="Agents">
          {getAvailableModes().map((m: { id: string; label: string }) => (
            <div key={m.id}
              className={`sidebar-item ${agentMode === m.id ? "active" : ""}`}
              onClick={() => changeMode(m.id as AgentMode)}>
              <span className="dot" style={{ background: agentMode === m.id ? "#00ff88" : "#333" }} />
              {MODE_LABELS[m.id] || m.label}
            </div>
          ))}
        </Section>

        <Section title="Sessions">
          <div className="sidebar-item" onClick={() => uiStore.setState({ goalsOpen: true })}>
            <span className="dot" style={{ background: "#00ff88" }} />
            Goals
            {goalCount !== null && <span className="badge">{goalCount}</span>}
          </div>
          <div className="sidebar-item" onClick={() => uiStore.setState({ swarmOpen: true })}>
            <span className="dot" style={{ background: "#aa66ff" }} />
            Swarms
            {swarmCount !== null && <span className="badge">{swarmCount}</span>}
          </div>
          <div className="sidebar-item" onClick={() => uiStore.setState({ dashboardOpen: true })}>
            <span className="dot" style={{ background: "#ffcc00" }} />
            Dashboard
          </div>
        </Section>

        <Section title="Model">
          <div className="sidebar-item" style={{ cursor: "default" }}>
            <span style={{ color: model ? "#00ff88" : "#555" }}>●</span>
            {model || "qwen2.5:3b"}
          </div>
          <div className="sidebar-item" style={{ cursor: "default" }}>
            <span style={{ color: "#888" }}>{provider || "ollama"}</span>
          </div>
        </Section>

        <Section title="Shortcuts">
          <div className="text-xs text-muted" style={{ lineHeight: 1.8 }}>
            Tab — switch mode<br />
            Ctrl+P — palette<br />
            Ctrl+G — goals<br />
            Ctrl+W — swarms<br />
            Ctrl+D — dashboard<br />
            Ctrl+S — toggle sidebar<br />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="sidebar-section-title">{title}</div>
      {children}
    </div>
  );
}
