import React from "react";
import { Box, Text } from "ink";
import { appStore } from "@arelyos/ui-core/stores/app-store.js";

export function Header() {
  const [, forceUpdate] = React.useState(0);
  React.useEffect(() => {
    const unsub = appStore.subscribe(() => forceUpdate((n) => n + 1));
    return () => { unsub(); };
  }, []);

  const { provider, model, agentMode } = appStore.getState();

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan" bold>  arely</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">
          {agentMode.charAt(0).toUpperCase() + agentMode.slice(1).replace("-", " ")}
          {" · "}{model || "no model"}
          {" · "}{provider}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color="dimGreen">  tab</Text><Text color="gray"> agents  </Text>
        <Text color="dimGreen">ctrl+k</Text><Text color="gray"> models  </Text>
        <Text color="dimGreen">ctrl+d</Text><Text color="gray"> dashboard  </Text>
        <Text color="dimGreen">ctrl+g</Text><Text color="gray"> goals  </Text>
        <Text color="dimGreen">ctrl+s</Text><Text color="gray"> sessions</Text>
      </Box>
    </Box>
  );
}
