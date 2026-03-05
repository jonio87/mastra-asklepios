import { randomUUID } from 'node:crypto';

// ─── Constants ──────────────────────────────────────────────────────────────

export const AGENT_ID = 'asklepios';
export const DEFAULT_RESOURCE = 'asklepios-knowledge';
export const QUIT_COMMANDS = new Set(['/quit', '/exit', '/q']);

export const HELP_TEXT = `
╔══════════════════════════════════════════════════════════════════╗
║                    Asklepios REPL Commands                      ║
╠══════════════════════════════════════════════════════════════════╣
║  /help              Show this help message                      ║
║  /patient <id>      Switch to a patient case (sets resource ID) ║
║  /thread <id>       Switch conversation thread                  ║
║  /new               Start a new conversation thread             ║
║  /status            Show current session info                   ║
║  /quit, /exit, /q   Exit the REPL                               ║
╚══════════════════════════════════════════════════════════════════╝
`;

// ─── Session State ──────────────────────────────────────────────────────────

export interface Session {
  resourceId: string;
  threadId: string;
}

export function createSession(resourceId?: string): Session {
  return {
    resourceId: resourceId ?? DEFAULT_RESOURCE,
    threadId: randomUUID(),
  };
}

// ─── Command Handling ───────────────────────────────────────────────────────

export interface CommandResult {
  session: Session;
  quit: boolean;
  output: string;
}

export function handleCommand(input: string, session: Session): CommandResult {
  const [command, ...args] = input.split(/\s+/);

  if (!command) return { session, quit: false, output: '' };

  if (QUIT_COMMANDS.has(command)) {
    return { session, quit: true, output: '\nGoodbye!\n' };
  }

  switch (command) {
    case '/help': {
      return { session, quit: false, output: HELP_TEXT };
    }
    case '/patient': {
      const patientId = args[0];
      if (!patientId) {
        return { session, quit: false, output: 'Usage: /patient <id>\n' };
      }
      const updated: Session = {
        resourceId: `patient-${patientId}`,
        threadId: randomUUID(),
      };
      return {
        session: updated,
        quit: false,
        output: `Switched to patient "${patientId}" (new thread: ${updated.threadId.slice(0, 8)}...)\n`,
      };
    }
    case '/thread': {
      const threadId = args[0];
      if (!threadId) {
        return { session, quit: false, output: 'Usage: /thread <id>\n' };
      }
      return { session: { ...session, threadId }, quit: false, output: '' };
    }
    case '/new': {
      const updated: Session = { ...session, threadId: randomUUID() };
      return {
        session: updated,
        quit: false,
        output: `New thread: ${updated.threadId.slice(0, 8)}...\n`,
      };
    }
    case '/status': {
      const output = `\nSession Status:\n  Resource: ${session.resourceId}\n  Thread:   ${session.threadId}\n  Agent:    ${AGENT_ID}\n\n`;
      return { session, quit: false, output };
    }
    default: {
      return {
        session,
        quit: false,
        output: `Unknown command: ${command}. Type /help for available commands.\n`,
      };
    }
  }
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

export function getPrompt(session: Session): string {
  const label =
    session.resourceId === DEFAULT_RESOURCE
      ? 'asklepios'
      : session.resourceId.replace(/^patient-/, '');
  return `\x1b[36m${label}\x1b[0m > `;
}

// ─── CLI Argument Parsing ───────────────────────────────────────────────────

export function parseArgs(argv: string[]): { patientId?: string } {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === '--patient' || arg === '-p') && next) {
      return { patientId: next };
    }
  }

  return {};
}
