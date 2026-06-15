import React from "react";
import { Box, Text } from "ink";

type ToolStatus = "pending" | "running" | "completed" | "error";

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];

function statusGlyph(status: ToolStatus): string {
  switch (status) {
    case "pending": return "◉";
    case "running": return "◉";
    case "completed": return "✓";
    case "error": return "✗";
  }
}

function statusColor(status: ToolStatus): string {
  switch (status) {
    case "pending": return "gray";
    case "running": return "cyan";
    case "completed": return "green";
    case "error": return "red";
  }
}

function argSummary(args: Record<string, unknown>, toolName: string): string {
  if (toolName === "websearch") return String(args.query ?? "");
  if (toolName === "webfetch") return String(args.url ?? "");
  return JSON.stringify(args).slice(0, 80);
}

function AnimatedDot() {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 200);
    return () => clearInterval(id);
  }, []);
  return <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>;
}

export function ToolCallCard({ part }: { part: { id: string; toolName: string; status: string; args: Record<string, unknown>; result?: string; error?: string; startTime?: number; endTime?: number } }) {
  const [expanded, setExpanded] = React.useState(part.status === "error");
  React.useEffect(() => { if (part.status === "error") setExpanded(true); }, [part.status]);

  const glyph = statusGlyph(part.status as ToolStatus);
  const color = statusColor(part.status as ToolStatus);
  const summary = argSummary(part.args, part.toolName);
  const elapsed = part.startTime && part.endTime ? (part.endTime - part.startTime) / 1000 : null;
  const toggleable = part.status === "completed" || part.status === "error";

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Title line */}
      <Box>
        {part.status === "running" ? <AnimatedDot /> : <Text color={color}>{glyph}</Text>}
        <Text color={color}> {part.toolName}</Text>
        {elapsed !== null && <Text color="gray"> ({elapsed.toFixed(1)}s)</Text>}
        {summary && part.status !== "running" && <Text color="gray"> — {summary.slice(0, 40)}</Text>}
      </Box>

      {/* Running indicator */}
      {part.status === "running" && (
        <Box marginLeft={3}>
          <AnimatedDot />
          <Text color="cyan"> {summary.slice(0, 60) || "running…"}</Text>
        </Box>
      )}

      {part.status === "pending" && (
        <Box marginLeft={3}><Text color="gray">◌ queued</Text></Box>
      )}

      {/* Completed/Error — collapsible */}
      {(part.status === "completed" || part.status === "error") && (
        <Box marginLeft={3} flexDirection="column">
          <Box>
            <Text color="gray">{toggleable ? (expanded ? "▼" : "▶") : " "}</Text>
            <Text color={color}>
              {" "}{part.status === "completed" ? "Done" : "Failed"}{elapsed !== null ? ` (${elapsed.toFixed(1)}s)` : ""}
            </Text>
          </Box>
          {expanded && (
            <Box flexDirection="column" marginTop={1}>
              {JSON.stringify(part.args).length > 2 && (
                <Box><Text color="gray">args: </Text><Text color="gray">{JSON.stringify(part.args).slice(0, 200)}</Text></Box>
              )}
              {part.result && (
                <Box marginTop={1}><Text color="gray">result: </Text><Text color="gray" wrap="wrap">{part.result.slice(0, 400)}</Text></Box>
              )}
              {part.error && (
                <Box marginTop={1}><Text color="red">error: </Text><Text color="red">{part.error}</Text></Box>
              )}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
