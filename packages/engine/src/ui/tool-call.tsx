import { Box, Text } from 'ink';
import React from 'react';
import type { ToolCallPart, ToolStatus } from '../types.js';

function statusGlyph(status: ToolStatus): string {
  switch (status) {
    case 'pending': return '◈';
    case 'running': return '◉';
    case 'completed': return '✓';
    case 'error': return '✗';
    default: return '?';
  }
}

function statusColor(status: ToolStatus): string {
  switch (status) {
    case 'pending': return 'gray';
    case 'running': return 'cyan';
    case 'completed': return 'green';
    case 'error': return 'red';
    default: return 'white';
  }
}

export function ToolCallCard({ part }: { part: ToolCallPart }) {
  const displayName = part.metadata?.provider ?? part.toolName;
  const argDisplay = part.toolName === 'websearch'
    ? String(part.args.query ?? '')
    : part.toolName === 'webfetch'
    ? String(part.args.url ?? '')
    : JSON.stringify(part.args).slice(0, 80);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={statusColor(part.status as ToolStatus)}>
          {statusGlyph(part.status as ToolStatus)} {displayName}
        </Text>
      </Box>
      <Box marginLeft={3}>
        <Text color="white" wrap="truncate">
          {argDisplay}
        </Text>
      </Box>
      <Box marginLeft={3}>
        <Text color={statusColor(part.status as ToolStatus)}>
          {'━'.repeat(Math.min(20, Math.max(10, (process.stdout.columns ?? 80) - 10)))}
          {' '}{part.status}
        </Text>
      </Box>
      {part.result && part.status === 'completed' && (
        <Box marginLeft={3} marginTop={1}>
          <Text color="gray" wrap="wrap">
            {part.result.slice(0, 200)}
            {part.result.length > 200 ? '...' : ''}
          </Text>
        </Box>
      )}
      {part.error && (
        <Box marginLeft={3}>
          <Text color="red">{part.error}</Text>
        </Box>
      )}
      {part.startTime && part.endTime && (
        <Box marginLeft={3}>
          <Text color="gray">{(part.endTime - part.startTime) / 1000}s</Text>
        </Box>
      )}
    </Box>
  );
}
