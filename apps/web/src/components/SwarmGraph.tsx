"use client";

import React from "react";

interface Task {
  id: string;
  role: string;
  goal: string;
  dependencies: string[];
}

interface GraphProps {
  tasks: Task[];
  phases: string[][];
}

const ROLE_COLORS: Record<string, string> = {
  planner: "#00ff88",
  researcher: "#00aaff",
  coder: "#ffcc00",
  reviewer: "#ff6600",
  synthesizer: "#aa66ff",
};

export function SwarmGraph({ tasks, phases }: GraphProps) {
  if (tasks.length === 0) return <div style={{ color: "#555" }}>No graph data</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {phases.map((batch, phaseIdx) => (
        <div key={phaseIdx}>
          <div style={{ color: "#666", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
            Phase {phaseIdx + 1}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {batch.map((taskId) => {
              const task = tasks.find((t) => t.id === taskId);
              if (!task) return null;
              return (
                <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "#1a1a1a", borderRadius: 4, border: `1px solid ${ROLE_COLORS[task.role] || "#333"}40` }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: ROLE_COLORS[task.role] || "#666", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ color: ROLE_COLORS[task.role] || "#ccc", fontSize: 13 }}>{task.role}</span>
                    <span style={{ color: "#555", fontSize: 11, marginLeft: 8 }}>{task.id}</span>
                    <div style={{ color: "#666", fontSize: 11, marginTop: 1 }}>{task.goal}</div>
                  </div>
                  {task.dependencies.length > 0 && (
                    <div style={{ color: "#444", fontSize: 10 }}>
                      ← {task.dependencies.map((d) => tasks.find((t) => t.id === d)?.role || d).join(", ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {phaseIdx < phases.length - 1 && (
            <div style={{ textAlign: "center", color: "#333", padding: "4px 0", fontSize: 12 }}>
              │
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SwarmGraphASCII({ tasks, phases }: GraphProps) {
  const lines: string[] = [];
  for (const batch of phases) {
    for (const taskId of batch) {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) continue;
      const role = task.role.padEnd(14);
      const deps = task.dependencies.length > 0
        ? ` ← ${task.dependencies.map((d) => tasks.find((t) => t.id === d)?.role || d).join(", ")}`
        : "";
      lines.push(`  ${role}${deps}`);
    }
    lines.push("");
  }
  return (
    <pre style={{ color: "#888", fontSize: 12, fontFamily: "inherit", margin: 0, whiteSpace: "pre-wrap" }}>
      {lines.join("\n")}
    </pre>
  );
}