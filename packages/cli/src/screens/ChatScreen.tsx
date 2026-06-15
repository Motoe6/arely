import React from "react";
import { Box, Text, useInput } from "ink";
import { HeaderBar } from "../components/HeaderBar.js";
import { ChatWindow } from "../components/ChatWindow.js";
import { Sidebar } from "../components/Sidebar.js";
import { ModelSelector } from "../components/ModelSelector.js";
import { GoalsPanel } from "../components/GoalsPanel.js";
import { DashboardPanel } from "../components/DashboardPanel.js";
import { CommandPalette } from "../components/CommandPalette.js";
import { StatusBar } from "../components/StatusBar.js";
import { uiStore } from "@arely/ui-core/stores/ui-store.js";
import { appStore } from "@arely/ui-core/stores/app-store.js";
import { getAvailableModes, changeMode } from "@arely/ui-core/services/swarm-service.js";
import { sessionStore } from "@arely/ui-core/stores/session-store.js";
import { sendMessage, cancelSession } from "@arely/ui-core/services/session-service.js";
import type { AgentMode } from "@arely/ui-core/types/index.js";
import type { EngineContext } from "../engine.js";

export function ChatScreen({ engine }: { engine?: EngineContext }) {
  const [input, setInput] = React.useState("");

  useInput((_input, key) => {
    const { permissionRequest, sessionState } = sessionStore.getState();
    const { paletteOpen } = uiStore.getState();

    if (_input === "p" && key.ctrl) {
      uiStore.setState({ paletteOpen: !uiStore.getState().paletteOpen });
      return;
    }

    if (paletteOpen) return;

    if (permissionRequest) {
      if (_input === "y" || _input === "Y" || key.return) {
        sessionStore.setState({ permissionRequest: null });
      } else if (_input === "n" || _input === "N") {
        sessionStore.setState({ permissionRequest: null });
      }
      return;
    }

    if (_input === "\t") {
      const modes = getAvailableModes();
      const current = appStore.getState().agentMode;
      const idx = modes.findIndex((m: { id: string }) => m.id === current);
      const next = modes[(idx + 1) % modes.length].id as AgentMode;
      changeMode(next);
      return;
    }
    if (_input === "k" && key.ctrl) {
      uiStore.setState({ modelSelectorOpen: !uiStore.getState().modelSelectorOpen });
      return;
    }
    if (_input === "d" && key.ctrl) {
      uiStore.setState({ dashboardOpen: !uiStore.getState().dashboardOpen });
      return;
    }
    if (_input === "g" && key.ctrl) {
      uiStore.setState({ goalsOpen: !uiStore.getState().goalsOpen });
      return;
    }
    if (_input === "s" && key.ctrl) {
      uiStore.setState({ sidebarOpen: !uiStore.getState().sidebarOpen });
      return;
    }
    if (key.escape) {
      uiStore.setState({ goalsOpen: false, dashboardOpen: false, modelSelectorOpen: false });
      return;
    }
    if (_input === "c" && key.ctrl) {
      cancelSession();
      return;
    }

    if (sessionState === "running") return;

    if (key.return && input.trim()) {
      const query = input.trim();
      setInput("");
      sendMessage(query).catch(() => {});
      return;
    }
    if (key.backspace || key.delete) {
      setInput((p) => p.slice(0, -1));
      return;
    }
    if (_input && _input.length === 1 && _input !== "\t") {
      setInput((p) => p + _input);
    }
  });

  const [, forceUpdate] = React.useState(0);
  React.useEffect(() => {
    const unsub1 = sessionStore.subscribe(() => forceUpdate((n) => n + 1));
    const unsub2 = uiStore.subscribe(() => forceUpdate((n) => n + 1));
    return () => { unsub1(); unsub2(); };
  }, []);

  const { sessionState, permissionRequest } = sessionStore.getState();

  return (
    <Box flexDirection="column" height="100%">
      {/* Header bar — always visible */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} paddingBottom={0} paddingTop={0}>
        <HeaderBar />
      </Box>

      {/* Main area: Sidebar + Chat */}
      <Box flexDirection="row" flexGrow={1} minHeight={1}>
        {/* Sidebar — always visible (compact toggle via Ctrl+S) */}
        <Sidebar engine={engine} />

        {/* Right column — chat + overlays */}
        <Box flexDirection="column" flexGrow={1}>
          <ModelSelector />
          <DashboardPanel engine={engine} />
          <GoalsPanel />
          <ChatWindow />
        </Box>
      </Box>

      {/* Prompt input line */}
      <Box minHeight={2} borderStyle="single" borderColor="gray" paddingX={1}>
        {permissionRequest ? (
          <Text color="yellow">
            Allow {permissionRequest.tool}? [Y/n]
          </Text>
        ) : sessionState === "running" ? (
          <Text color="cyan">{">"} (in progress...)</Text>
        ) : (
          <Box flexGrow={1}>
            <Text color="cyan">{">"} </Text>
            <Text>{input}</Text>
            <Text color="cyan">▌</Text>
          </Box>
        )}
      </Box>

      {/* Status bar — compact metrics */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} paddingBottom={0} paddingTop={0}>
        <StatusBar />
      </Box>

      <CommandPalette />
    </Box>
  );
}
