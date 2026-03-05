import { Box, Text } from 'ink';
import type React from 'react';
import { formatUsage } from '../utils/usage-tracker.js';
import { ACCENT, ACCENT_DARK, DANGER, FG, SURFACE_400 } from './theme.js';
import type { Message } from './types.js';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps): React.JSX.Element {
  if (message.role === 'user') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={ACCENT} bold>
          You:
        </Text>
        <Box marginLeft={2}>
          <Text>{message.content}</Text>
        </Box>
      </Box>
    );
  }

  if (message.role === 'system') {
    return (
      <Box marginBottom={1} flexDirection="column">
        <Text color={ACCENT_DARK}>{'─── system ───'}</Text>
        <Box marginLeft={2}>
          <Text color={FG}>{message.content}</Text>
        </Box>
      </Box>
    );
  }

  // Assistant message
  const agentLabel = message.agentId ? ` [${message.agentId}]` : '';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={DANGER} bold>
        Asklepios{agentLabel}:
      </Text>
      <Box marginLeft={2} flexDirection="column">
        <Text color={FG} wrap="wrap">
          {message.content}
        </Text>
        {message.tokens ? (
          <Text color={SURFACE_400} italic>
            [{formatUsage(message.tokens)}]
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
