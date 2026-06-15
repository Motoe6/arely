"use client";

import React from "react";

export function ToolCallCard({ part }: { part: { id: string; toolName: string; status: string; args: Record<string, unknown>; result?: string; error?: string; startTime?: number; endTime?: number } }) {
  const [expanded, setExpanded] = React.useState(part.status === "error");
  React.useEffect(() => { if (part.status === "error") setExpanded(true); }, [part.status]);

  const glyph = part.status === "completed" ? "✓" : part.status === "error" ? "✗" : "◉";
  const color = part.status === "completed" ? "#00cc66" : part.status === "error" ? "#ff4444" : "#00ff88";
  const elapsed = part.startTime && part.endTime ? ((part.endTime - part.startTime) / 1000).toFixed(1) : null;
  const toggleable = part.status === "completed" || part.status === "error";
  const summary = summarizeArgs(part.args, part.toolName);

  return (
    <div className="tool-card" style={{ paddingLeft: 0, marginBottom: 2 }}>
      <div className="tool-card-header" onClick={() => toggleable && setExpanded((e) => !e)} style={{ cursor: toggleable ? "pointer" : "default" }}>
        <span className="tool-card-icon" style={{ color }}>{glyph}</span>
        <span className="tool-card-name" style={{ color }}>{part.toolName}</span>
        {elapsed && <span className="tool-card-time">({elapsed}s)</span>}
        {summary && part.status !== "running" && <span className="tool-card-args">— {summary.slice(0, 40)}</span>}
        {toggleable && <span style={{ color: "#444", fontSize: 11, marginLeft: "auto" }}>{expanded ? "▼" : "▶"}</span>}
      </div>

      {part.status === "running" && (
        <div className="tool-card-status" style={{ color: "#00ff88" }}>
          ● {summary.slice(0, 60) || "running…"}
        </div>
      )}

      {part.status === "pending" && (
        <div className="tool-card-status" style={{ color: "#555" }}>◌ queued</div>
      )}

      {(part.status === "completed" || part.status === "error") && (
        <div className="tool-card-status" style={{ color }}>
          {toggleable ? (expanded ? "▼" : "▶") : " "} {part.status === "completed" ? "Done" : "Failed"}{elapsed ? ` (${elapsed}s)` : ""}
        </div>
      )}

      {expanded && (part.status === "completed" || part.status === "error") && (
        <div className="tool-card-detail">
          {JSON.stringify(part.args).length > 2 && (
            <pre><span style={{ color: "#555" }}>args: </span>{JSON.stringify(part.args, null, 2).slice(0, 200)}</pre>
          )}
          {part.result && (
            <pre style={{ marginTop: 4 }}><span style={{ color: "#555" }}>result: </span>{part.result.slice(0, 400)}</pre>
          )}
          {part.error && (
            <pre style={{ marginTop: 4, color: "#ff4444" }}><span style={{ color: "#555" }}>error: </span>{part.error}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function summarizeArgs(args: Record<string, unknown>, toolName: string): string {
  if (toolName === "websearch") return String(args.query ?? "");
  if (toolName === "webfetch") return String(args.url ?? "");
  return JSON.stringify(args).slice(0, 80);
}
