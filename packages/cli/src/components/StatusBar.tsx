import React from "react";
import { Box, Text } from "ink";
import { appStore } from "@arely/ui-core/stores/app-store.js";
import { sessionStore } from "@arely/ui-core/stores/session-store.js";
import { getGoals } from "../services/goal-service.js";

export function StatusBar() {
  const [, forceUpdate] = React.useState(0);
  const [goalsCount, setGoalsCount] = React.useState(0);

  React.useEffect(() => {
    const unsub1 = appStore.subscribe(() => forceUpdate((n) => n + 1));
    const unsub2 = sessionStore.subscribe(() => forceUpdate((n) => n + 1));
    getGoals().then((g) => setGoalsCount(g.length));
    return () => { unsub1(); unsub2(); };
  }, []);

  const { isEngineRunning, model, provider, agentMode } = appStore.getState();
  const { sessionState } = sessionStore.getState();
  const modelShort = model?.split(":")[0] ?? "—";
  const swarmLabel = agentMode === "single" ? "OFF" : "ON";

  return (
    <Box width="100%" justifyContent="space-between">
      <Box>
        <Text color="gray">
          <Text color="green">G:</Text><Text color="white">{goalsCount}</Text>
          <Text color="gray"> │ </Text>
          <Text color="yellow">M:</Text><Text color="white">0</Text>
          <Text color="gray"> │ </Text>
          <Text color={agentMode === "single" ? "gray" : "green"}>S:</Text>
          <Text color={agentMode === "single" ? "gray" : "green"}>{swarmLabel}</Text>
        </Text>
      </Box>
      <Box>
        <Text color="gray">
          <Text color={sessionState === "running" ? "cyan" : "gray"}>{sessionState}</Text>
          <Text color="gray"> · </Text>
          <Text color="cyan">{modelShort}</Text>
          <Text color="gray"> · </Text>
          <Text color="dimGreen">{provider}</Text>
        </Text>
      </Box>
    </Box>
  );
}
