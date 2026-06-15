import React from "react";
import { Box, Text } from "ink";
import { appStore } from "@arely/ui-core/stores/app-store.js";
import { getAvailableModes, changeMode } from "@arely/ui-core/services/swarm-service.js";

export function AgentSelector() {
  const modes = getAvailableModes();
  const current = appStore.getState().agentMode;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1}>
      <Text bold color="cyan">Agents</Text>
      <Box marginTop={1} flexDirection="column">
        {modes.map((m: { id: string; label: string }) => (
          <Text key={m.id} color={m.id === current ? "green" : "gray"}>
            {m.id === current ? " ●" : " ○"} {m.label}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Press Tab to cycle modes</Text>
      </Box>
    </Box>
  );
}
