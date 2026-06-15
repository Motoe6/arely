import React from "react";
import { Box, Text, useInput } from "ink";
import { appStore } from "@arely/ui-core/stores/app-store.js";
import type { EngineContext } from "../engine.js";

export function HomeScreen({ onStart, engine }: { onStart: () => void; engine?: EngineContext }) {
  useInput((_input, key) => {
    if (key.return) onStart();
  });

  const { username, provider, model, agentMode } = appStore.getState();
  const sessions = engine?.getSessions() ?? [];
  const recent = sessions.slice(-3).reverse();
  const firstLines = recent.map((s: { id: string; messages: { role: string; content: string }[] }) =>
    s.messages.find((m) => m.role === "user")?.content?.slice(0, 50) ?? s.id.slice(0, 8),
  );

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" height="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={4} paddingY={1} flexDirection="column" alignItems="center">
        <Text color="cyan" bold>ARELY v0.1.0</Text>
        <Box marginTop={1}>
          <Text>Bienvenido, </Text>
          <Text bold>{username}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">{">"}</Text>
          <Text> </Text>
          <Text color="gray">Ask anything</Text>
          <Text color="cyan">…</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="dimGreen">Tab</Text><Text color="gray"> agents  </Text>
          <Text color="dimGreen">Ctrl+K</Text><Text color="gray"> models  </Text>
          <Text color="dimGreen">Ctrl+D</Text><Text color="gray"> dash  </Text>
          <Text color="dimGreen">Ctrl+G</Text><Text color="gray"> goals  </Text>
          <Text color="dimGreen">Ctrl+S</Text><Text color="gray"> sidebar</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">
            {agentMode.charAt(0).toUpperCase() + agentMode.slice(1).replace("-", " ")}
            {" · "}{model || "no model"}
            {" · "}{provider}
          </Text>
        </Box>
      </Box>

      {recent.length > 0 && (
        <Box marginTop={1} flexDirection="column" alignItems="center">
          <Text color="gray">Últimas sesiones</Text>
          {firstLines.map((line: string, i: number) => (
            <Box key={i}>
              <Text color="green">  ● </Text>
              <Text color="gray">{line}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">Press </Text>
        <Text color="cyan" bold>Enter</Text>
        <Text color="gray"> to start</Text>
      </Box>
    </Box>
  );
}
