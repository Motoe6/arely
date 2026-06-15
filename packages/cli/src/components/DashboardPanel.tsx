import React from "react";
import { Box, Text, useInput } from "ink";
import { uiStore } from "@arely/ui-core/stores/ui-store.js";
import { appStore } from "@arely/ui-core/stores/app-store.js";
import { sessionStore } from "@arely/ui-core/stores/session-store.js";
import type { DashboardMetrics, EngineContext } from "../engine.js";

export function DashboardPanel({ engine }: { engine?: EngineContext }) {
  const [metrics, setMetrics] = React.useState<DashboardMetrics | null>(null);

  React.useEffect(() => {
    if (!engine?.getMetrics) return;
    const poll = () => engine.getMetrics!().then(setMetrics).catch(() => {});
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [engine]);

  useInput((_input, key) => {
    if (key.escape || (_input === "d" && key.ctrl)) {
      uiStore.setState({ dashboardOpen: false });
    }
  });

  if (!uiStore.getState().dashboardOpen) return null;

  const { isEngineRunning } = appStore.getState();
  const { messages, toolCalls, sessionState } = sessionStore.getState();
  const m = metrics;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1} marginBottom={1}>
      <Text bold color="yellow">Dashboard</Text>

      <Box marginTop={1}>
        <Box width={22}><Text color="gray">Server</Text></Box>
        <Text color={isEngineRunning ? "green" : "red"}>{isEngineRunning ? "ONLINE" : "OFFLINE"}</Text>
      </Box>
      <Box>
        <Box width={22}><Text color="gray">Sessions</Text></Box>
        <Text>{m?.sessions ?? "..."}</Text>
      </Box>
      <Box>
        <Box width={22}><Text color="gray">Memories</Text></Box>
        <Text>{m?.memories ?? "..."}</Text>
      </Box>
      <Box>
        <Box width={22}><Text color="gray">Goals</Text></Box>
        <Text>{m?.goals ?? "..."}</Text>
      </Box>
      <Box>
        <Box width={22}><Text color="gray">Swarm</Text></Box>
        <Text color={m?.swarmActive ? "green" : "gray"}>{m?.swarmActive ? "ON" : "OFF"}</Text>
      </Box>
      <Box marginTop={1}>
        <Box width={22}><Text color="gray">Prediction Error</Text></Box>
        <Text>{m?.predictionError.toFixed(2) ?? "..."}</Text>
      </Box>
      <Box>
        <Box width={22}><Text color="gray">Calibration Error</Text></Box>
        <Text>{m?.calibrationError.toFixed(2) ?? "..."}</Text>
      </Box>
      <Box>
        <Box width={22}><Text color="gray">Strategy Success</Text></Box>
        <Text>{m?.strategySuccess ?? "..."}%</Text>
      </Box>
      <Box>
        <Box width={22}><Text color="gray">Avg Latency</Text></Box>
        <Text>{m?.avgLatencyMs ?? "..."}ms</Text>
      </Box>
      <Box>
        <Box width={22}><Text color="gray">Cost Today</Text></Box>
        <Text>${m?.costToday.toFixed(4) ?? "..."}</Text>
      </Box>
      <Box>
        <Box width={22}><Text color="gray">Session State</Text></Box>
        <Text color={sessionState === "running" ? "cyan" : "gray"}>{sessionState}</Text>
      </Box>

      <Box marginTop={1}>
        <Text color="gray">Press Ctrl+D or Esc to close</Text>
      </Box>
    </Box>
  );
}
