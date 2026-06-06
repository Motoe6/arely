import { Box, Text } from 'ink';
import React from 'react';
import type { PermissionRequest } from '../types.js';

export function PermissionPrompt({
  request,
  onResponse,
}: {
  request: PermissionRequest;
  onResponse: (granted: boolean) => void;
}) {
  const desc = request.args.query
    ? `"${String(request.args.query).slice(0, 80)}"`
    : request.args.url
    ? String(request.args.url).slice(0, 80)
    : '';

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="yellow">Allow {request.tool}?</Text>
      </Box>
      {desc && (
        <Box marginLeft={2}>
          <Text color="gray">{desc}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="yellow">[Y/n] </Text>
        <Text color="gray">(press Y to allow, N to deny)</Text>
      </Box>
    </Box>
  );
}
