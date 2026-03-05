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
║  /usage             Show token usage for this session            ║
║  /network           Toggle network mode (multi-agent routing)   ║
║  /resume <wf> <step> [data]  Resume a suspended workflow        ║
║  /quit, /exit, /q   Exit the REPL                               ║
╚══════════════════════════════════════════════════════════════════╝
`;

// ─── Session State ──────────────────────────────────────────────────────────

export interface Session {
  resourceId: string;
  threadId: string;
  networkMode: boolean;
}

export function createSession(resourceId?: string): Session {
  return {
    resourceId: resourceId ?? DEFAULT_RESOURCE,
    threadId: randomUUID(),
    networkMode: false,
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
        networkMode: session.networkMode,
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
      const mode = session.networkMode ? 'network (multi-agent)' : 'direct (single agent)';
      const output = `\nSession Status:\n  Resource: ${session.resourceId}\n  Thread:   ${session.threadId}\n  Agent:    ${AGENT_ID}\n  Mode:     ${mode}\n\n`;
      return { session, quit: false, output };
    }
    case '/network': {
      const updated: Session = { ...session, networkMode: !session.networkMode };
      const modeLabel = updated.networkMode ? 'ENABLED' : 'DISABLED';
      const description = updated.networkMode
        ? 'Messages will be routed to specialized agents (phenotype, research, synthesis, brain)'
        : 'Messages go directly to Asklepios with its own tools';
      return {
        session: updated,
        quit: false,
        output: `Network mode ${modeLabel}: ${description}\n`,
      };
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

// ─── Patient Context ────────────────────────────────────────────────────────

export function getPatientInstructions(session: Session): string | undefined {
  const match = session.resourceId.match(/^patient-(.+)$/);
  if (!match) return undefined;
  const patientId = match[1];
  return `You are currently assisting with patient case "${patientId}". Reference this patient by their case ID throughout your responses. When greeting the user, acknowledge you are working on this patient's case. All tool calls and memory operations should be scoped to this patient.`;
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

export function getPrompt(session: Session): string {
  const label =
    session.resourceId === DEFAULT_RESOURCE
      ? 'asklepios'
      : session.resourceId.replace(/^patient-/, '');
  const modeIndicator = session.networkMode ? ' \x1b[33m[net]\x1b[0m' : '';
  return `\x1b[36m${label}\x1b[0m${modeIndicator} > `;
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
