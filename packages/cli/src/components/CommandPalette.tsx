import React from "react";
import { Box, Text, useInput } from "ink";
import { uiStore } from "@arely/ui-core/stores/ui-store.js";

interface Command {
  id: string;
  label: string;
  desc: string;
  key: string;
  action: () => void;
}

const COMMANDS: Command[] = [
  { id: "new", label: "New Session", desc: "Start a fresh conversation", key: "", action: () => uiStore.setState({ paletteOpen: false }) },
  { id: "model", label: "Switch Model", desc: "Change the active LLM model", key: "ctrl+k", action: () => { uiStore.setState({ paletteOpen: false, modelSelectorOpen: true }); } },
  { id: "swarm", label: "Toggle Swarm Mode", desc: "Switch to swarm agent mode", key: "tab", action: () => { uiStore.setState({ paletteOpen: false }); } },
  { id: "goal", label: "Create Goal", desc: "Define a new persistent goal", key: "ctrl+g", action: () => { uiStore.setState({ paletteOpen: false, goalsOpen: true }); } },
  { id: "bench", label: "Run Benchmark", desc: "Execute benchmark suite", key: "", action: () => { uiStore.setState({ paletteOpen: false }); } },
  { id: "sidebar", label: "Toggle Compact Sidebar", desc: "Slim or full sidebar", key: "ctrl+s", action: () => { const s = uiStore.getState(); uiStore.setState({ sidebarOpen: !s.sidebarOpen, paletteOpen: false }); } },
  { id: "dashboard", label: "Open Dashboard", desc: "Show engine metrics", key: "ctrl+d", action: () => { uiStore.setState({ paletteOpen: false, dashboardOpen: true }); } },
  { id: "goals-view", label: "View Goals", desc: "Browse all goals and progress", key: "ctrl+g", action: () => { uiStore.setState({ paletteOpen: false, goalsOpen: true }); } },
  { id: "cancel", label: "Cancel Session", desc: "Stop running session", key: "ctrl+c", action: () => { uiStore.setState({ paletteOpen: false }); } },
  { id: "help", label: "Help", desc: "Show keyboard shortcuts", key: "", action: () => uiStore.setState({ paletteOpen: false }) },
];

function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  if (qi < q.length) return -1;
  const firstIdx = t.indexOf(q[0]);
  const matchLen = q.length;
  return -(firstIdx * 10 + matchLen);
}

export function CommandPalette() {
  const [query, setQuery] = React.useState("");
  const [cursor, setCursor] = React.useState(0);

  const filtered = query.trim()
    ? COMMANDS
        .map((c) => ({ cmd: c, score: fuzzyScore(query, c.label + " " + c.desc) }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => a.score - b.score)
        .map((x) => x.cmd)
    : COMMANDS;

  React.useEffect(() => setCursor(0), [query]);

  useInput((_input, key) => {
    if (key.escape) {
      uiStore.setState({ paletteOpen: false });
      return;
    }
    if (key.return && filtered[cursor]) {
      filtered[cursor].action();
      setQuery("");
      return;
    }
    if (key.upArrow || (_input === "k" && key.ctrl)) {
      setCursor((p) => Math.max(0, p - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((p) => Math.min(filtered.length - 1, p + 1));
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((p) => p.slice(0, -1));
      return;
    }
    if (_input && _input.length === 1 && _input !== "\t") {
      setQuery((p) => p + _input);
    }
  });

  if (!uiStore.getState().paletteOpen) return null;

  return (
    <Box position="absolute" top={3} left={4} width={56} flexDirection="column" borderStyle="single" borderColor="cyan">
      {/* Search input */}
      <Box paddingX={1}>
        <Text color="cyan">{">"} </Text>
        <Text>{query}</Text>
        <Text color="cyan">▌</Text>
      </Box>
      <Box borderStyle="single" borderColor="gray" height={1} marginX={0} marginY={0} />

      {/* Results */}
      <Box flexDirection="column" paddingX={1}>
        {filtered.length === 0 ? (
          <Text color="gray">  No matching commands</Text>
        ) : filtered.slice(0, 10).map((cmd, i) => (
          <Box key={cmd.id}>
            <Text color={i === cursor ? "cyan" : "gray"}>
              {i === cursor ? "▸ " : "  "}
            </Text>
            <Text color={i === cursor ? "white" : "gray"}>{cmd.label}</Text>
            <Text color="gray">  </Text>
            <Text color="gray">{cmd.desc.slice(0, 30)}</Text>
            {cmd.key && (
              <Text color="gray">  [{cmd.key}]</Text>
            )}
          </Box>
        ))}
      </Box>
      <Box marginTop={1} paddingX={1}>
        <Text color="gray">Type to filter · ↑↓ navigate · Enter select · Esc close</Text>
      </Box>
    </Box>
  );
}
