import React from "react";
import { Box, Text } from "ink";
import { uiStore } from "@arelyos/ui-core/stores/ui-store.js";
import { appStore } from "@arelyos/ui-core/stores/app-store.js";
import { getGoals } from "../services/goal-service.js";
import type { EngineContext } from "../engine.js";

const MODES = ["single", "planner", "swarm", "shared-memory", "manager"] as const;
const MODE_LABELS: Record<string, string> = {
  single: "Single", planner: "Planner", swarm: "Swarm",
  "shared-memory": "SharedMem", manager: "Manager",
};

function bar(pct: number, width = 8): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function Sidebar({ engine }: { engine?: EngineContext }) {
  const [, forceUpdate] = React.useState(0);
  const [goals, setGoals] = React.useState<{ title: string; pct: number }[]>([]);

  React.useEffect(() => {
    const unsub1 = uiStore.subscribe(() => forceUpdate((n) => n + 1));
    const unsub2 = appStore.subscribe(() => forceUpdate((n) => n + 1));
    getGoals().then((g) => setGoals(g.slice(0, 5).map((x) => ({ title: x.title.slice(0, 16), pct: x.progressPct }))));
    return () => { unsub1(); unsub2(); };
  }, []);

  const { agentMode } = appStore.getState();
  const sessions = engine?.getSessions() ?? [];

  const compact = !uiStore.getState().sidebarOpen;

  return (
    <Box flexDirection="column" width={compact ? 10 : 20} borderStyle="single" borderColor="gray" paddingX={1} marginRight={1}>
      {/* Agent mode */}
      <Text bold color="cyan">{compact ? "Ag" : "Agents"}</Text>
      <Text color="green"> ● {MODE_LABELS[agentMode]?.slice(0, compact ? 6 : 10) ?? agentMode}</Text>

      {/* Sessions count */}
      <Box marginTop={1}>
        <Text bold color="cyan">{compact ? "Se" : "Sessions"}</Text>
      </Box>
      <Text color="gray">  {sessions.length > 0 ? `● ${sessions.length}` : "(none)"}</Text>

      {/* Goals */}
      <Box marginTop={1}>
        <Text bold color="cyan">{compact ? "Go" : "Goals"}</Text>
      </Box>
      {goals.length === 0 ? (
        <Text color="gray">  (none)</Text>
      ) : goals.map((g, i) => (
        <Box key={i} flexDirection="column">
          {!compact && <Text color="gray">{g.title}</Text>}
          <Text color="gray">{bar(g.pct, compact ? 4 : 8)}</Text>
        </Box>
      ))}

      {/* Keybinds hint */}
      {!compact && (
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Tab agents</Text>
          <Text color="gray">Ctrl+P palette</Text>
          <Text color="gray">Ctrl+S slim</Text>
        </Box>
      )}
    </Box>
  );
}
