import React from "react";
import { Box } from "ink";
import { HomeScreen } from "./screens/HomeScreen.js";
import { ChatScreen } from "./screens/ChatScreen.js";
import type { EngineContext } from "./engine.js";

export type Screen = "home" | "chat";

export function App({ engine }: { engine?: EngineContext }) {
  const [screen, setScreen] = React.useState<Screen>("home");

  return (
    <Box flexDirection="column" height="100%">
      {screen === "home" && <HomeScreen onStart={() => setScreen("chat")} engine={engine} />}
      {screen === "chat" && <ChatScreen engine={engine} />}
    </Box>
  );
}
