"use client";

import React from "react";

interface Contribution {
  role: string;
  taskId: string;
  content: string;
  timestamp: number;
}

export function SwarmMemory({ contributions }: { contributions: Contribution[] }) {
  if (contributions.length === 0) {
    return <div style={{ color: "#555", fontSize: 12, textAlign: "center", padding: 16 }}>No shared memory contributions yet</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
        Shared Working Memory ({contributions.length} contributions)
      </div>
      {contributions.map((c, i) => (
        <div key={`${c.taskId}-${i}`} style={{ padding: 8, background: "#1a1a1a", borderRadius: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: "#00ff88", fontSize: 12 }}>{c.role}</span>
            <span style={{ color: "#555", fontSize: 11 }}>{c.taskId}</span>
          </div>
          <div style={{ color: "#999", fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {c.content.length > 200 ? c.content.slice(0, 200) + "..." : c.content}
          </div>
        </div>
      ))}
    </div>
  );
}