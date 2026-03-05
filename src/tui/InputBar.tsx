import { TextInput } from '@inkjs/ui';
import { Box, Text } from 'ink';
import type React from 'react';
import { useState } from 'react';
import type { Session } from '../cli-utils.js';
import { DEFAULT_RESOURCE } from '../cli-utils.js';
import { ACCENT, ACCENT_DARK, BG_MID, SURFACE_400, SURFACE_500, WARNING } from './theme.js';

interface InputBarProps {
  session: Session;
  isStreaming: boolean;
  onSubmit: (text: string) => void;
  onCommand: (input: string) => string | undefined;
  onQuit: () => void;
}

const SLASH_COMMANDS = [
  '/help',
  '/patient',
  '/thread',
  '/new',
  '/status',
  '/usage',
  '/network',
  '/resume',
  '/quit',
];

export function InputBar({
  session,
  isStreaming,
  onSubmit,
  onCommand,
  onQuit,
}: InputBarProps): React.JSX.Element {
  // Increment key to force TextInput remount (clears internal state)
  const [inputKey, setInputKey] = useState(0);

  const label =
    session.resourceId === DEFAULT_RESOURCE
      ? 'asklepios'
      : session.resourceId.replace(/^patient-/, '');

  const modeIndicator = session.networkMode ? ' [net]' : '';
  const prompt = `${label}${modeIndicator}`;

  const handleSubmit = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Force remount to clear TextInput internal state
    setInputKey((k) => k + 1);

    if (trimmed.startsWith('/')) {
      const result = onCommand(trimmed);
      if (result === 'quit') {
        onQuit();
      }
      return;
    }

    onSubmit(trimmed);
  };

  return (
    <Box borderStyle="single" borderColor={ACCENT_DARK} paddingX={1} backgroundColor={BG_MID}>
      <Text color={ACCENT} bold>
        {prompt}
      </Text>
      <Text color={session.networkMode ? WARNING : SURFACE_400}> {'> '}</Text>
      {isStreaming ? (
        <Text color={SURFACE_500}>Thinking...</Text>
      ) : (
        <TextInput
          key={inputKey}
          placeholder="Type a message or /help for commands..."
          suggestions={SLASH_COMMANDS}
          onSubmit={handleSubmit}
        />
      )}
    </Box>
  );
}
