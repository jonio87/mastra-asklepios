import { Spinner } from '@inkjs/ui';
import { Box, Text } from 'ink';
import type React from 'react';
import { MessageBubble } from './MessageBubble.js';
import { ACCENT, DANGER, FG, SURFACE_500 } from './theme.js';
import type { Message } from './types.js';

interface ConversationPaneProps {
  messages: Message[];
  isStreaming: boolean;
  streamingText: string;
  streamingAgentId: string;
}

export function ConversationPane({
  messages,
  isStreaming,
  streamingText,
  streamingAgentId,
}: ConversationPaneProps): React.JSX.Element {
  const hasContent = messages.length > 0 || isStreaming;

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      overflowY="hidden"
      justifyContent={hasContent ? 'flex-end' : 'center'}
    >
      {/* Empty state */}
      {!hasContent ? (
        <Box justifyContent="center" alignItems="center">
          <Text color={SURFACE_500}>
            Type a message to start. <Text color={ACCENT}>/help</Text> for commands. Ctrl+N new
            thread, Ctrl+T toggle network.
          </Text>
        </Box>
      ) : null}

      {/* Completed messages — gravity to bottom so newest are always visible */}
      {messages.map((message: Message) => (
        <Box key={message.id}>
          <MessageBubble message={message} />
        </Box>
      ))}

      {/* Currently streaming message */}
      {isStreaming ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={DANGER} bold>
            Asklepios{streamingAgentId ? ` [${streamingAgentId}]` : ''}:
          </Text>
          <Box marginLeft={2}>
            {streamingText ? (
              <Text color={FG} wrap="wrap">
                {streamingText}
              </Text>
            ) : (
              <Spinner label="Thinking..." />
            )}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
