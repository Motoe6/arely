"use client";

import React from "react";
import { uiStore } from "@arely/ui-core/stores/ui-store";

const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL || "http://localhost:8081";

interface Goal {
  id: string;
  title: string;
  description: string;
  status: "active" | "paused" | "completed" | "abandoned";
  priority: number;
  progressPct: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface Plan {
  id: string;
  title: string;
  description: string;
  status: string;
  progressPct: number;
  sortOrder: number;
  milestones: Milestone[];
}

interface Milestone {
  id: string;
  description: string;
  status: "pending" | "completed";
  weight: number;
}

export function GoalsPanel() {
  const [goals, setGoals] = React.useState<Goal[]>([]);
  const [selectedGoal, setSelectedGoal] = React.useState<Goal | null>(null);
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [forecast, setForecast] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");

  const fetchGoals = React.useCallback(async () => {
    try {
      const res = await fetch(`${ENGINE_URL}/api/goals`);
      const data = await res.json();
      setGoals(data.goals || []);
    } catch { /* engine offline */ }
    setLoading(false);
  }, []);

  React.useEffect(() => { fetchGoals(); }, [fetchGoals]);

  const selectGoal = async (g: Goal) => {
    setSelectedGoal(g);
    setForecast(null);
    try {
      const [detailRes, forecastRes] = await Promise.all([
        fetch(`${ENGINE_URL}/api/goals/${g.id}`),
        fetch(`${ENGINE_URL}/api/goals/${g.id}/forecast`),
      ]);
      const detail = await detailRes.json();
      const fc = await forecastRes.json();
      setPlans(detail.plans || []);
      setForecast(fc.forecast || null);
    } catch { /* ignore */ }
  };

  const createGoal = async () => {
    if (!newTitle.trim()) return;
    try {
      await fetch(`${ENGINE_URL}/api/goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      setNewTitle("");
      setCreating(false);
      fetchGoals();
    } catch { /* ignore */ }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "active": return "#00ff88";
      case "paused": return "#ffcc00";
      case "completed": return "#00cc66";
      case "abandoned": return "#ff4444";
      default: return "#666";
    }
  };

  if (selectedGoal) {
    return (
      <div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <div style={{ color: "#00ff88", fontSize: 18, marginBottom: 4 }}>{selectedGoal.title}</div>
              <div style={{ color: "#666", fontSize: 13 }}>{selectedGoal.description}</div>
            </div>
            <span style={{ color: statusColor(selectedGoal.status), fontSize: 12, border: `1px solid ${statusColor(selectedGoal.status)}`, borderRadius: 4, padding: "2px 8px" }}>
              {selectedGoal.status}
            </span>
          </div>

          <ProgressBar pct={selectedGoal.progressPct} />

          {forecast && (
            <div style={{ marginTop: 12, padding: 8, background: "#1a1a1a", borderRadius: 4 }}>
              <div style={{ color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Forecast</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                <Metric label="Success" value={`${Math.round(forecast.predictedSuccessPct * 100)}%`} />
                <Metric label="Gain" value={`${Math.round(forecast.predictedProgressGainPct * 100)}%`} />
                <Metric label="Expected Utility" value={(forecast.expectedUtility ?? 0).toFixed(2)} />
                <Metric label="Confidence" value={`${Math.round(forecast.confidence * 100)}%`} />
              </div>
            </div>
          )}

          {plans.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Plans</div>
              {plans.sort((a, b) => a.sortOrder - b.sortOrder).map((plan) => (
                <div key={plan.id} style={{ marginBottom: 12, padding: 8, background: "#1a1a1a", borderRadius: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: "#ccc", fontSize: 14 }}>{plan.title}</span>
                    <span style={{ color: plan.status === "completed" ? "#00cc66" : plan.status === "in_progress" ? "#00ff88" : "#666", fontSize: 12 }}>
                      {plan.status}
                    </span>
                  </div>
                  <ProgressBar pct={plan.progressPct} compact />
                  {plan.milestones.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      {plan.milestones.map((ms) => (
                        <div key={ms.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#888", marginTop: 2 }}>
                          <span style={{ color: ms.status === "completed" ? "#00cc66" : "#555" }}>
                            {ms.status === "completed" ? "✓" : "○"}
                          </span>
                          <span style={{ color: ms.status === "completed" ? "#888" : "#777" }}>{ms.description}</span>
                          <span style={{ marginLeft: "auto", color: "#555", fontSize: 11 }}>w:{ms.weight}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <button onClick={() => { setSelectedGoal(null); setPlans([]); setForecast(null); }}
            style={{ marginTop: 12, background: "#222", color: "#888", border: "1px solid #333", borderRadius: 4, padding: "4px 12px", cursor: "pointer", width: "100%" }}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Goals</div>
        <button onClick={() => setCreating(true)}
          style={{ background: "none", border: "none", color: "#00ff88", cursor: "pointer", fontSize: 16 }}>
          +
        </button>
      </div>

      {creating && (
        <div style={{ marginBottom: 8, display: "flex", gap: 4 }}>
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createGoal(); if (e.key === "Escape") { setCreating(false); setNewTitle(""); } }}
            placeholder="Goal title..."
            autoFocus
            style={{ flex: 1, background: "#1a1a1a", border: "1px solid #333", color: "#e0e0e0", borderRadius: 4, padding: "4px 8px", fontSize: 13, outline: "none" }} />
        </div>
      )}

      {loading ? (
        <div style={{ color: "#555", fontSize: 12 }}>Loading...</div>
      ) : goals.length === 0 ? (
        <div style={{ color: "#555", fontSize: 12 }}>No goals yet</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, overflow: "auto", flex: 1 }}>
          {goals.map((g) => (
            <div key={g.id} onClick={() => selectGoal(g)}
              style={{ padding: "6px 8px", background: "#1a1a1a", borderRadius: 4, cursor: "pointer", border: "1px solid transparent" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ color: "#ccc", fontSize: 13 }}>{g.title}</span>
                <span style={{ color: statusColor(g.status), fontSize: 11 }}>{g.status}</span>
              </div>
              <ProgressBar pct={g.progressPct} compact />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ pct, compact }: { pct: number; compact?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: compact ? 4 : 6, background: "#222", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", background: pct >= 100 ? "#00cc66" : "#00ff88", borderRadius: 3, transition: "width 0.3s" }} />
      </div>
      <span style={{ color: "#666", fontSize: compact ? 11 : 12 }}>{Math.round(pct)}%</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "1px 0" }}>
      <span style={{ color: "#666" }}>{label}</span>
      <span style={{ color: "#ccc" }}>{value}</span>
    </div>
  );
}