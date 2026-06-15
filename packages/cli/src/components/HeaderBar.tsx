import React from "react";
import { Box, Text } from "ink";
import { appStore } from "@arelyos/ui-core/stores/app-store.js";
import { sessionStore } from "@arelyos/ui-core/stores/session-store.js";

export function HeaderBar() {
  const [, forceUpdate] = React.useState(0);
  React.useEffect(() => {
    const unsub1 = appStore.subscribe(() => forceUpdate((n) => n + 1));
    const unsub2 = sessionStore.subscribe(() => forceUpdate((n) => n + 1));
    return () => { unsub1(); unsub2(); };
  }, []);

  const { provider, model, isEngineRunning } = appStore.getState();
  const { sessionState } = sessionStore.getState();
  const engineStatus = isEngineRunning ? "●" : "○";
  const statusColor = isEngineRunning ? "green" : "red";
  const modelShort = model?.split(":")[0] ?? "no model";

  return (
    <Box width="100%" justifyContent="space-between">
      <Box>
        <Text bold color="cyan">ARELY</Text>
        <Text color="gray"> v0.1.0</Text>
      </Box>
      <Box>
        <Text color={statusColor}>{engineStatus}</Text>
        <Text color="gray"> {modelShort} · {provider}</Text>
        {sessionState === "running" && <Text color="cyan"> RUNNING</Text>}
      </Box>
    </Box>
  );
}
