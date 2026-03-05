import type { Key } from 'ink';
import { Box, useApp, useInput, useStdout } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { ConversationPane } from './ConversationPane.js';
import { Header } from './Header.js';
import { InputBar } from './InputBar.js';
import { BG_DEEP } from './theme.js';
import { useAsklepios } from './useAsklepios.js';

interface AppProps {
  patientId?: string | undefined;
}

export function App({ patientId }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout.rows ?? 24);

  // Track terminal resize
  useEffect(() => {
    const onResize = (): void => {
      setRows(stdout.rows ?? 24);
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  const {
    messages,
    isStreaming,
    session,
    sessionUsage,
    streamingText,
    streamingAgentId,
    sendMessage,
    handleSlashCommand,
  } = useAsklepios(patientId ? { initialPatientId: patientId } : {});

  // Keyboard shortcuts
  useInput((_input: string, key: Key) => {
    if (key.ctrl && _input === 'n') {
      handleSlashCommand('/new');
    }
    if (key.ctrl && _input === 't') {
      handleSlashCommand('/network');
    }
  });

  const handleQuit = (): void => {
    exit();
  };

  return (
    <Box flexDirection="column" height={rows} backgroundColor={BG_DEEP}>
      {/* Header — fixed at top */}
      <Header session={session} sessionUsage={sessionUsage} />

      {/* Conversation — fills remaining space, overflow hidden */}
      <ConversationPane
        messages={messages}
        isStreaming={isStreaming}
        streamingText={streamingText}
        streamingAgentId={streamingAgentId}
      />

      {/* Input bar — fixed at bottom */}
      <InputBar
        session={session}
        isStreaming={isStreaming}
        onSubmit={sendMessage}
        onCommand={handleSlashCommand}
        onQuit={handleQuit}
      />
    </Box>
  );
}
