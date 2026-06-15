import React from "react";
import { Box, Text } from "ink";
import { sessionStore } from "@arely/ui-core/stores/session-store.js";

export function Prompt({
  onSubmit,
}: {
  onSubmit: (query: string) => void;
}) {
  const [input, setInput] = React.useState("");
  const [, forceUpdate] = React.useState(0);
  React.useEffect(() => {
    const unsub = sessionStore.subscribe(() => forceUpdate((n) => n + 1));
    return () => { unsub(); };
  }, []);

  const { sessionState, permissionRequest } = sessionStore.getState();

  return (
    <Box minHeight={2} borderStyle="single" borderColor="gray" paddingX={1}>
      {permissionRequest ? (
        <Text color="yellow">
          Allow {permissionRequest.tool}? [Y/n]{" "}
          {String(permissionRequest.args.query ?? permissionRequest.args.url ?? "").slice(0, 60)}
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
  );
}
