"use client";

import React from "react";
import { appStore } from "@arelyos/ui-core/stores/app-store";
import { sessionStore } from "@arelyos/ui-core/stores/session-store";

const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL || "http://localhost:8081";

export function StatusBar() {
  const [, forceUpdate] = React.useState(0);
  const [goalCount, setGoalCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    const u1 = appStore.subscribe(() => forceUpdate((n) => n + 1));
    const u2 = sessionStore.subscribe(() => forceUpdate((n) => n + 1));
    fetch(`${ENGINE_URL}/api/goals`).then((r) => r.json()).then((d) => setGoalCount(d.goals?.length ?? null)).catch(() => {});
    return () => { u1(); u2(); };
  }, []);

  const { model, provider, isEngineRunning, agentMode } = appStore.getState();
  const { sessionState } = sessionStore.getState();
  const modeShort: Record<string, string> = { single: "S", planner: "P", swarm: "SW", "shared-memory": "SM", manager: "M" };

  return (
    <div className="status-bar">
      <div className="status-left">
        <span className="header-dot online" />
        <span><span className="status-label">G:</span><span className="status-value">{goalCount ?? "--"}</span></span>
        <span><span className="status-label">M:</span><span className="status-value">--</span></span>
        <span>
          <span className="status-label">S:</span>
          <span className="status-value" style={{ color: agentMode === "single" ? "#555" : "#00ff88" }}>
            {agentMode === "single" ? "OFF" : "ON"}
          </span>
        </span>
      </div>
      <div className="status-right">
        <span style={{ color: sessionState === "running" ? "#00ff88" : sessionState === "error" ? "#ff4444" : "#555" }}>
          {sessionState}
        </span>
        <span style={{ color: "#444" }}>|</span>
        <span className="status-value">{model?.split(":")[0] || "—"}</span>
        <span className="status-label">{provider}</span>
        <span style={{ color: "#333" }}>{modeShort[agentMode] || "S"}</span>
      </div>
    </div>
  );
}
