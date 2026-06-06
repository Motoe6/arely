import { Box, Text } from 'ink';
import React from 'react';
import type { SessionMessage, ToolCallPart, PermissionRequest, SessionState } from '../types.js';
import { ToolCallCard } from './tool-call.js';

export function SessionView({
  messages,
  toolCalls,
  permissionRequest,
  sessionState,
  streamingText,
}: {
  messages: SessionMessage[];
  toolCalls: ToolCallPart[];
  permissionRequest: PermissionRequest | null;
  sessionState: SessionState;
  streamingText: string;
}) {
  const activeToolCalls = toolCalls.filter((t) => t.status === 'running' || t.status === 'pending');
  const completedToolCalls = toolCalls.filter((t) => t.status === 'completed' || t.status === 'error');

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>OpenCode Agent Session</Text>
      </Box>

      {messages.filter((m) => m.role === 'user').map((m, i) => (
        <Box key={`q-${i}`} marginBottom={1}>
          <Text color="cyan">&gt; </Text>
          <Text color="white" bold>{m.content}</Text>
        </Box>
      ))}

      {[...activeToolCalls, ...completedToolCalls].map((tc) => (
        <ToolCallCard key={tc.id} part={tc} />
      ))}

      {streamingText && sessionState === 'running' && (
        <Box marginBottom={1}>
          <Text color="white">{streamingText.slice(0, 200)}</Text>
          <Text color="cyan">▌</Text>
        </Box>
      )}

      {messages.filter((m) => m.role === 'assistant' && m.content && !m.toolCalls).map((m, i) => (
        <Box key={`a-${i}`} marginBottom={1} flexDirection="column">
          <Text color="white" wrap="wrap">{m.content.slice(0, 500)}</Text>
        </Box>
      ))}

      {sessionState === 'completed' && (
        <Box marginTop={1}>
          <Text color="green">✓ Session complete</Text>
        </Box>
      )}

      {sessionState === 'error' && (
        <Box marginTop={1}>
          <Text color="red">✗ Session error</Text>
        </Box>
      )}

      {sessionState === 'idle' && (
        <Box marginTop={1}>
          <Text color="gray">Type a query and press Enter to start a session.</Text>
        </Box>
      )}
    </Box>
  );
}
