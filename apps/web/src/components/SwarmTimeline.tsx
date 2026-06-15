"use client";

import React from "react";

interface Role {
  role: string;
  taskId: string;
  goal: string;
  dependencies: string[];
  status: "completed" | "running" | "queued" | "failed";
}

export function SwarmTimeline({ roles, onSelect }: { roles: Role[]; onSelect?: (r: Role) => void }) {
  const glyph = (s: string) => {
    switch (s) {
      case "completed": return { char: "✓", color: "#00cc66" };
      case "running": return { char: "●", color: "#00ff88" };
      case "failed": return { char: "✕", color: "#ff4444" };
      default: return { char: "○", color: "#555" };
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {roles.map((r) => {
        const g = glyph(r.status);
        return (
          <div key={r.taskId} onClick={() => onSelect?.(r)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 4, cursor: onSelect ? "pointer" : "default" }}>
            <span style={{ color: g.color, fontSize: 16, width: 16, textAlign: "center" }}>{g.char}</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#ccc", fontSize: 13, marginBottom: 1 }}>{r.role}</div>
              <div style={{ color: "#666", fontSize: 11 }}>{r.goal}</div>
            </div>
            {r.dependencies.length > 0 && (
              <span style={{ color: "#444", fontSize: 10 }}>dep: {r.dependencies.length}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}