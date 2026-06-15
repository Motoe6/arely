"use client";

import React from "react";
import { appStore } from "@arelyos/ui-core/stores/app-store";
import { uiStore } from "@arelyos/ui-core/stores/ui-store";

const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL || "http://localhost:8081";

interface DashboardData {
  status: string;
  health: { uptime: number; status: string };
  models: { id: string; provider: string; enabled: boolean }[];
  engineMode: string;
}

export function DashboardOverlay() {
  const [, forceUpdate] = React.useState(0);
  const [data, setData] = React.useState<DashboardData>({
    status: "unknown",
    health: { uptime: 0, status: "unknown" },
    models: [],
    engineMode: "unknown",
  });
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const unsub = appStore.subscribe(() => forceUpdate((n) => n + 1));
    Promise.all([
      fetch(`${ENGINE_URL}/health`).then((r) => r.json()).catch(() => ({ uptime: 0, status: "offline" })),
      fetch(`${ENGINE_URL}/api/models`).then((r) => r.json()).catch(() => ({ data: [] })),
      fetch(`${ENGINE_URL}/api/sessions`).then((r) => r.json()).catch(() => ({ sessions: [] })),
    ]).then(([health, models]) => {
      setData({
        status: health.status || "unknown",
        health,
        models: models.data || [],
        engineMode: appStore.getState().agentMode,
      });
      setLoading(false);
    });
    return () => { unsub(); };
  }, []);

  const { isEngineRunning, model, provider, sessionId } = appStore.getState();

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}
      onClick={() => uiStore.setState({ dashboardOpen: false })}>
      <div style={{ background: "#111", border: "1px solid #333", borderRadius: 8, padding: 24, minWidth: 420, maxHeight: "80vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ color: "#00ff88", fontSize: 18 }}>Dashboard</div>
          <button onClick={() => uiStore.setState({ dashboardOpen: false })}
            style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 18 }}>
            ×
          </button>
        </div>

        {loading ? (
          <div style={{ color: "#555", textAlign: "center", padding: 20 }}>Loading...</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            <Section title="Engine">
              <Row label="Status" value={isEngineRunning ? "Online" : "Offline"} color={isEngineRunning ? "#00ff88" : "#ff4444"} />
              <Row label="Uptime" value={`${data.health.uptime || 0}s`} />
            </Section>

            <Section title="Session">
              <Row label="Active Session" value={sessionId ? sessionId.slice(0, 12) + "..." : "None"} />
              <Row label="Mode" value={data.engineMode} />
            </Section>

            <Section title="Model">
              <Row label="Current" value={model || "qwen2.5:3b"} />
              <Row label="Provider" value={provider || "ollama"} />
              <Row label="Available" value={String(data.models.length)} />
            </Section>

            {data.models.length > 0 && (
              <Section title="Models Registry">
                {data.models.slice(0, 10).map((m) => (
                  <Row key={m.id} label={m.id} value={m.provider} color={m.enabled ? "#00ff88" : "#555"} />
                ))}
              </Section>
            )}

          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, borderBottom: "1px solid #222", paddingBottom: 4 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
      <span style={{ color: "#666", fontSize: 13 }}>{label}</span>
      <span style={{ color: color || "#888", fontSize: 13 }}>{value}</span>
    </div>
  );
}