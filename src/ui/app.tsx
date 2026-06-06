import { Box, Text, useInput } from 'ink';
import React, { useState, useRef } from 'react';
import type { SessionMessage, ToolCallPart, PermissionRequest, SessionState, SessionEvent } from '../types.js';
import type { SSEBus } from '../server/sse.js';
import type { AgentSession } from '../server/session.js';
import { SessionView } from './session-view.js';

export function App({
  sse,
  sessions,
  newSession,
}: {
  sse: SSEBus;
  sessions: Map<string, AgentSession>;
  newSession: (query: string) => AgentSession;
}) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallPart[]>([]);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [streamingText, setStreamingText] = useState('');
  const activeSession = useRef<AgentSession | null>(null);
  const inputRef = useRef('');

  inputRef.current = input;

  useInput((_input, key) => {
    if (permissionRequest) {
      if (_input === 'y' || _input === 'Y' || key.return) {
        const req = permissionRequest;
        setPermissionRequest(null);
        activeSession.current?.resolvePermission(req.id, true);
      } else if (_input === 'n' || _input === 'N') {
        const req = permissionRequest;
        setPermissionRequest(null);
        activeSession.current?.resolvePermission(req.id, false);
      }
      return;
    }

    if (key.return && inputRef.current.trim()) {
      const query = inputRef.current.trim();
      setInput('');
      setStreamingText('');
      const session = newSession(query);
      activeSession.current = session;
      sessions.set(session.id, session);

      sse.on(session.id, (event: SessionEvent) => {
        switch (event.type) {
          case 'message':
            setMessages((prev) => [...prev, event.data as SessionMessage]);
            break;
          case 'tool_start': {
            const part = event.data as ToolCallPart;
            setToolCalls((prev) => {
              const existing = prev.findIndex((t) => t.id === part.id);
              if (existing >= 0) {
                const next = [...prev];
                next[existing] = part;
                return next;
              }
              return [...prev, part];
            });
            break;
          }
          case 'tool_complete': {
            const part = event.data as ToolCallPart;
            setToolCalls((prev) => {
              const existing = prev.findIndex((t) => t.id === part.id);
              if (existing >= 0) {
                const next = [...prev];
                next[existing] = part;
                return next;
              }
              return [...prev, part];
            });
            break;
          }
          case 'tool_error': {
            const part = event.data as ToolCallPart;
            setToolCalls((prev) => {
              const existing = prev.findIndex((t) => t.id === part.id);
              if (existing >= 0) {
                const next = [...prev];
                next[existing] = part;
                return next;
              }
              return [...prev, part];
            });
            break;
          }
          case 'permission_request':
            setPermissionRequest(event.data as PermissionRequest);
            break;
          case 'session_state_change': {
            const { state } = event.data as { state: SessionState };
            setSessionState(state);
            break;
          }
          case 'session_end':
            setSessionState('completed');
            break;
          case 'streaming_text': {
            const { content } = event.data as { content: string };
            setStreamingText((prev) => prev + content);
            break;
          }
        }
      });

      session.run(query).catch(() => {});
      return;
    }

    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    if (_input && _input.length === 1) {
      setInput((prev) => prev + _input);
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1}>
        <SessionView
          messages={messages}
          toolCalls={toolCalls}
          permissionRequest={permissionRequest}
          sessionState={sessionState}
          streamingText={streamingText}
        />
      </Box>
      <Box minHeight={2} borderStyle="single" borderColor="gray" paddingX={1}>
        {permissionRequest ? (
          <Text color="yellow">
            Allow {permissionRequest.tool}? [Y/n]{' '}
            {String(permissionRequest.args.query ?? permissionRequest.args.url ?? '').slice(0, 60)}
          </Text>
        ) : sessionState === 'running' ? (
          <Text color="cyan">&gt; (session in progress...)</Text>
        ) : (
          <Text color="cyan">&gt; </Text>
        )}
        <Text color="white">{permissionRequest ? '' : input}</Text>
        {!permissionRequest && sessionState !== 'running' && (
          <Text color="cyan">▌</Text>
        )}
      </Box>
    </Box>
  );
}
