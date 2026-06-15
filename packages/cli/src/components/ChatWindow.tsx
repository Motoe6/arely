import React from "react";
import { Box, Text } from "ink";
import { ToolCallCard } from "./ToolCall.js";
import { PermissionPrompt } from "./PermissionPrompt.js";
import { sessionStore } from "@arely/ui-core/stores/session-store.js";

type ToolPart = { id: string; toolName: string; status: string; args: Record<string, unknown>; result?: string; error?: string; startTime?: number; endTime?: number };

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];
const THINKING_PHASES = ["Searching", "Planning", "Analyzing", "Synthesizing"];

function Spinner() {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 150);
    return () => clearInterval(id);
  }, []);
  return <Text color="yellow">{SPINNER_FRAMES[frame]}</Text>;
}

function BlinkingCursor() {
  const [visible, setVisible] = React.useState(true);
  React.useEffect(() => {
    const id = setInterval(() => setVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, []);
  return visible ? <Text color="cyan">▌</Text> : <Text> </Text>;
}

export function ChatWindow() {
  const { messages, toolCalls, permissionRequest, sessionState, streamingText, isThinking } = sessionStore.getState();

  const activeToolCalls = toolCalls.filter((t: ToolPart) => t.status === "running" || t.status === "pending");
  const completedToolCalls = toolCalls.filter((t: ToolPart) => t.status === "completed" || t.status === "error");

  const [, forceUpdate] = React.useState(0);
  React.useEffect(() => {
    const unsub = sessionStore.subscribe(() => forceUpdate((n) => n + 1));
    return () => { unsub(); };
  }, []);

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      {/* User messages */}
      {messages.filter((m: { role: string }) => m.role === "user").map((m: { content: string }, i: number) => (
        <Box key={`q-${i}`} marginBottom={1}>
          <Text color="cyan">{"› "}</Text>
          <Text bold>{m.content}</Text>
        </Box>
      ))}

      {/* Tool calls — active first, then completed */}
      {[...activeToolCalls, ...completedToolCalls].map((tc: ToolPart) => (
        <ToolCallCard key={tc.id} part={tc} />
      ))}

      {/* Animated thinking state */}
      {isThinking && !streamingText && (
        <Box marginBottom={1}>
          <Spinner />
          <Text color="yellow"> Thinking</Text>
        </Box>
      )}

      {/* Streaming text with live cursor */}
      {streamingText && sessionState === "running" && (
        <Box marginBottom={1}>
          <Text wrap="wrap">{streamingText.slice(0, 500)}</Text>
          <BlinkingCursor />
        </Box>
      )}

      {/* Completed assistant messages */}
      {messages.filter((m: { role: string; content?: string }) => m.role === "assistant" && m.content).map((m: { content: string }, i: number) => (
        <Box key={`a-${i}`} marginBottom={1} flexDirection="column">
          <Text wrap="wrap">{m.content.slice(0, 800)}</Text>
        </Box>
      ))}

      {/* Permission prompt */}
      {permissionRequest && (
        <PermissionPrompt
          request={permissionRequest}
          onResponse={() => { sessionStore.setState({ permissionRequest: null }); }}
        />
      )}

      {/* Session state indicators */}
      {sessionState === "completed" && (
        <Box marginTop={1}><Text color="green">  ✓ Complete</Text></Box>
      )}
      {sessionState === "error" && (
        <Box marginTop={1}><Text color="red">  ✗ Error</Text></Box>
      )}
      {sessionState === "idle" && (
        <Box marginTop={1}><Text color="gray">  Type a query and press Enter to start.</Text></Box>
      )}
    </Box>
  );
}
