import { Box, Text } from 'ink';
import type React from 'react';
import type { Session } from '../cli-utils.js';
import { DEFAULT_RESOURCE } from '../cli-utils.js';
import type { SessionUsage } from '../utils/usage-tracker.js';
import { ACCENT, ACCENT_DARK, BG_MID, SUCCESS, SURFACE_400, WARNING } from './theme.js';

interface HeaderProps {
  session: Session;
  sessionUsage: SessionUsage;
}

export function Header({ session, sessionUsage }: HeaderProps): React.JSX.Element {
  const label =
    session.resourceId === DEFAULT_RESOURCE
      ? 'asklepios'
      : session.resourceId.replace(/^patient-/, '');

  const threadShort = session.threadId.slice(0, 8);
  const mode = session.networkMode ? 'NET' : 'DIRECT';
  const { totals } = sessionUsage;

  return (
    <Box
      borderStyle="round"
      borderColor={ACCENT_DARK}
      paddingX={1}
      justifyContent="space-between"
      backgroundColor={BG_MID}
    >
      <Text bold color={ACCENT}>
        Asklepios
      </Text>
      <Text color={SURFACE_400}>
        patient: <Text color={SUCCESS}>{label}</Text>
      </Text>
      <Text color={SURFACE_400}>
        thread: <Text color={SURFACE_400}>{threadShort}</Text>
      </Text>
      <Text color={session.networkMode ? WARNING : SUCCESS}>[{mode}]</Text>
      <Text color={SURFACE_400}>
        {totals.inputTokens.toLocaleString()} in / {totals.outputTokens.toLocaleString()} out
      </Text>
    </Box>
  );
}
