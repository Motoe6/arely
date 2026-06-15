import React from "react";
import { Box, Text, useInput } from "ink";
import { uiStore } from "@arely/ui-core/stores/ui-store.js";
import { appStore } from "@arely/ui-core/stores/app-store.js";
import { listModels, changeModel } from "../services/model-service.js";

export function ModelSelector() {
  const [models, setModels] = React.useState<{ id: string; provider: string; label: string; enabled: boolean; isDefault: boolean }[]>([]);
  const [cursor, setCursor] = React.useState(0);

  React.useEffect(() => {
    listModels().then(setModels);
  }, []);

  useInput((_input, key) => {
    if (key.escape || (_input === "k" && key.ctrl)) {
      uiStore.setState({ modelSelectorOpen: false });
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(models.length - 1, c + 1));
      return;
    }
    if (key.return && models[cursor]) {
      changeModel(models[cursor].id);
      uiStore.setState({ modelSelectorOpen: false });
    }
  });

  if (!uiStore.getState().modelSelectorOpen) return null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1}>
      <Text bold color="cyan">Models</Text>
      <Text color="gray">Use arrows to navigate, Enter to select, Esc to close</Text>
      <Box marginTop={1} flexDirection="column">
        {models.map((m, i) => (
          <Text key={m.id} color={i === cursor ? "cyan" : m.isDefault ? "green" : "gray"}>
            {i === cursor ? " ▸" : "  "}
            {m.isDefault ? " ●" : " ○"} {m.label}
            <Text color="dimGreen"> ({m.provider})</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
