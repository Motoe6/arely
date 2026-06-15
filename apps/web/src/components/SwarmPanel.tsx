"use client";

import React from "react";
import { uiStore } from "@arely/ui-core/stores/ui-store";
import { SwarmTimeline } from "./SwarmTimeline";
import { SwarmGraph, SwarmGraphASCII } from "./SwarmGraph";
import { SwarmMemory } from "./SwarmMemory";

const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL || "http://localhost:8081";

type Tab = "timeline" | "graph" | "memory";

interface Role {
  role: string;
  taskId: string;
  goal: string;
  dependencies: string[];
  status: "completed" | "running" | "queued" | "failed";
}

interface Task {
  id: string;
  role: string;
  goal: string;
  dependencies: string[];
}

interface GraphData {
  tasks: Task[];
  phases: string[][];
}

interface Contribution {
  role: string;
  taskId: string;
  content: string;
  timestamp: number;
}

interface SwarmSummary {
  id: string;
  status: string;
  roleCount: number;
  phaseCount: number;
  request: string;
}

export function SwarmPanel() {
  const [tab, setTab] = React.useState<Tab>("timeline");
  const [, forceUpdate] = React.useState(0);
  const [swarms, setSwarms] = React.useState<SwarmSummary[]>([]);
  const [activeSwarmId, setActiveSwarmId] = React.useState<string | null>(null);
  const [roles, setRoles] = React.useState<Role[]>([]);
  const [graph, setGraph] = React.useState<GraphData | null>(null);
  const [contributions, setContributions] = React.useState<Contribution[]>([]);
  const [swarmStatus, setSwarmStatus] = React.useState("");
  const [selectedRole, setSelectedRole] = React.useState<Role | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const unsub = uiStore.subscribe(() => forceUpdate((n) => n + 1));
    fetchSwarms();
    return () => { unsub(); };
  }, []);

  const fetchSwarms = async () => {
    try {
      const res = await fetch(`${ENGINE_URL}/api/swarms`);
      const data = await res.json();
      setSwarms(data.swarms || []);
      if (data.swarms?.length > 0) {
        selectSwarm(data.swarms[0].id);
      }
    } catch { /* engine offline */ }
    setLoading(false);
  };

  const selectSwarm = async (id: string) => {
    setActiveSwarmId(id);
    try {
      const [detailRes, graphRes, memRes] = await Promise.all([
        fetch(`${ENGINE_URL}/api/swarms/${id}`),
        fetch(`${ENGINE_URL}/api/swarms/${id}/graph`),
        fetch(`${ENGINE_URL}/api/swarms/${id}/memory`),
      ]);
      const detail = await detailRes.json();
      const g = await graphRes.json();
      const m = await memRes.json();
      setRoles(detail.roles || []);
      setSwarmStatus(detail.swarm?.status || "unknown");
      setGraph(g.graph || null);
      setContributions(m.contributions || []);
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}>
        <div style={{ background: "#111", border: "1px solid #333", borderRadius: 8, padding: 32 }}>
          <div style={{ color: "#555" }}>Loading...</div>
        </div>
      </div>
    );
  }

  const close = () => uiStore.setState({ swarmOpen: false });

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}
      onClick={close}>
      <div style={{ background: "#111", border: "1px solid #333", borderRadius: 8, padding: 24, minWidth: 520, maxWidth: 640, maxHeight: "80vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Swarm</div>
            {activeSwarmId && (
              <span style={{ color: swarmStatus === "running" ? "#00ff88" : swarmStatus === "completed" ? "#00cc66" : "#666", fontSize: 12 }}>
                {swarmStatus}
              </span>
            )}
          </div>
          <button onClick={close} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 18 }}>×</button>
        </div>

        {selectedRole ? (
          <RoleDetail role={selectedRole} onBack={() => setSelectedRole(null)} tasks={graph?.tasks || []} />
        ) : swarms.length === 0 && roles.length === 0 ? (
          <div style={{ textAlign: "center", padding: 24 }}>
            <div style={{ color: "#555", marginBottom: 8 }}>No swarm executions yet</div>
            <div style={{ color: "#444", fontSize: 12, marginBottom: 16 }}>
              Swarm mode not yet wired into the session system. Select "shared-memory" or "swarm" mode from the sidebar to execute swarms.
            </div>
            <button onClick={async () => {
              try {
                const res = await fetch(`${ENGINE_URL}/api/swarms/default/graph`);
                const data = await res.json();
                if (data.graph) {
                  setGraph(data.graph);
                  setRoles(data.graph.tasks.map((t: Task) => ({
                    role: t.role,
                    taskId: t.id,
                    goal: t.goal,
                    dependencies: t.dependencies,
                    status: "queued" as const,
                  })));
                }
              } catch { /* ignore */ }
            }} style={{ background: "#1a1a1a", color: "#00ff88", border: "1px solid #333", borderRadius: 4, padding: "6px 16px", cursor: "pointer", fontSize: 13 }}>
              Show Default Task Graph
            </button>
          </div>
        ) : (
          <div>
            {swarms.length > 1 && (
              <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
                {swarms.map((s) => (
                  <button key={s.id} onClick={() => selectSwarm(s.id)}
                    style={{ background: s.id === activeSwarmId ? "#222" : "transparent", color: "#888", border: "1px solid #333", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11 }}>
                    {s.id.slice(0, 8)}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 2, marginBottom: 12, borderBottom: "1px solid #222" }}>
              {(["timeline", "graph", "memory"] as Tab[]).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  style={{ background: "none", border: "none", color: tab === t ? "#00ff88" : "#555", padding: "4px 12px", cursor: "pointer", fontSize: 12, borderBottom: tab === t ? "2px solid #00ff88" : "2px solid transparent", textTransform: "uppercase", letterSpacing: 1 }}>
                  {t}
                </button>
              ))}
            </div>

            {tab === "timeline" && (
              <SwarmTimeline roles={roles} onSelect={(r) => setSelectedRole(r)} />
            )}
            {tab === "graph" && graph && (
              <div>
                <SwarmGraph tasks={graph.tasks} phases={graph.phases} />
                <div style={{ marginTop: 12, borderTop: "1px solid #222", paddingTop: 8 }}>
                  <SwarmGraphASCII tasks={graph.tasks} phases={graph.phases} />
                </div>
              </div>
            )}
            {tab === "graph" && !graph && (
              <div style={{ color: "#555", textAlign: "center", padding: 16 }}>No graph data</div>
            )}
            {tab === "memory" && <SwarmMemory contributions={contributions} />}
          </div>
        )}
      </div>
    </div>
  );
}

function RoleDetail({ role, onBack, tasks }: { role: Role; onBack: () => void; tasks: Task[] }) {
  const statusColor = (s: string) => {
    switch (s) {
      case "completed": return "#00cc66";
      case "running": return "#00ff88";
      case "failed": return "#ff4444";
      default: return "#555";
    }
  };

  const depTasks = role.dependencies.map((d) => tasks.find((t) => t.id === d)).filter(Boolean);

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 13, marginBottom: 12 }}>← Back</button>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ color: statusColor(role.status), fontSize: 20 }}>{role.status === "completed" ? "✓" : role.status === "running" ? "●" : role.status === "failed" ? "✕" : "○"}</span>
          <span style={{ color: "#00ff88", fontSize: 18 }}>{role.role}</span>
          <span style={{ color: "#666", fontSize: 12 }}>{role.taskId}</span>
        </div>
        <div style={{ color: "#888", fontSize: 13, marginBottom: 8 }}>{role.goal}</div>
      </div>

      {depTasks.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Dependencies</div>
          {depTasks.map((t) => t && (
            <div key={t.id} style={{ color: "#666", fontSize: 12, padding: "2px 0" }}>✓ {t.role} ({t.id})</div>
          ))}
        </div>
      )}
    </div>
  );
}