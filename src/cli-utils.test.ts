import type { Session } from './cli-utils.js';
import {
  AGENT_ID,
  createSession,
  DEFAULT_RESOURCE,
  getPatientInstructions,
  getPrompt,
  handleCommand,
  parseArgs,
} from './cli-utils.js';

describe('cli-utils', () => {
  // ─── createSession ──────────────────────────────────────────────────────

  describe('createSession', () => {
    it('creates a session with default resource', () => {
      const session = createSession();
      expect(session.resourceId).toBe(DEFAULT_RESOURCE);
      expect(session.threadId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(session.networkMode).toBe(false);
    });

    it('creates a session with custom resource', () => {
      const session = createSession('patient-eds-001');
      expect(session.resourceId).toBe('patient-eds-001');
      expect(session.threadId).toBeDefined();
    });

    it('generates unique thread IDs', () => {
      const a = createSession();
      const b = createSession();
      expect(a.threadId).not.toBe(b.threadId);
    });
  });

  // ─── handleCommand ────────────────────────────────────────────────────

  describe('handleCommand', () => {
    const session: Session = {
      resourceId: 'patient-test-001',
      threadId: 'test-thread-id',
      networkMode: false,
    };

    it('returns quit for /quit', () => {
      const result = handleCommand('/quit', session);
      expect(result.quit).toBe(true);
    });

    it('returns quit for /exit', () => {
      const result = handleCommand('/exit', session);
      expect(result.quit).toBe(true);
    });

    it('returns quit for /q', () => {
      const result = handleCommand('/q', session);
      expect(result.quit).toBe(true);
    });

    it('returns help text for /help', () => {
      const result = handleCommand('/help', session);
      expect(result.quit).toBe(false);
      expect(result.output).toContain('Asklepios REPL Commands');
      expect(result.session).toBe(session);
    });

    it('switches patient with /patient <id>', () => {
      const result = handleCommand('/patient eds-001', session);
      expect(result.quit).toBe(false);
      expect(result.session.resourceId).toBe('patient-eds-001');
      expect(result.session.threadId).not.toBe(session.threadId);
      expect(result.output).toContain('eds-001');
    });

    it('shows usage for /patient without id', () => {
      const result = handleCommand('/patient', session);
      expect(result.output).toContain('Usage');
      expect(result.session).toBe(session);
    });

    it('switches thread with /thread <id>', () => {
      const result = handleCommand('/thread custom-thread', session);
      expect(result.session.threadId).toBe('custom-thread');
      expect(result.session.resourceId).toBe(session.resourceId);
    });

    it('shows usage for /thread without id', () => {
      const result = handleCommand('/thread', session);
      expect(result.output).toContain('Usage');
      expect(result.session).toBe(session);
    });

    it('creates new thread with /new', () => {
      const result = handleCommand('/new', session);
      expect(result.session.threadId).not.toBe(session.threadId);
      expect(result.session.resourceId).toBe(session.resourceId);
      expect(result.output).toContain('New thread');
    });

    it('shows status with /status', () => {
      const result = handleCommand('/status', session);
      expect(result.output).toContain(session.resourceId);
      expect(result.output).toContain(session.threadId);
      expect(result.output).toContain(AGENT_ID);
      expect(result.session).toBe(session);
    });

    it('toggles network mode on with /network', () => {
      const result = handleCommand('/network', session);
      expect(result.quit).toBe(false);
      expect(result.session.networkMode).toBe(true);
      expect(result.output).toContain('ENABLED');
    });

    it('toggles network mode off with /network', () => {
      const networkSession: Session = { ...session, networkMode: true };
      const result = handleCommand('/network', networkSession);
      expect(result.session.networkMode).toBe(false);
      expect(result.output).toContain('DISABLED');
    });

    it('shows mode in /status output', () => {
      const result = handleCommand('/status', session);
      expect(result.output).toContain('Mode');
      expect(result.output).toContain('direct');
    });

    it('returns error for unknown command', () => {
      const result = handleCommand('/foobar', session);
      expect(result.output).toContain('Unknown command');
      expect(result.output).toContain('/foobar');
      expect(result.session).toBe(session);
    });

    it('returns session unchanged for empty input', () => {
      const result = handleCommand('', session);
      expect(result.session).toBe(session);
      expect(result.quit).toBe(false);
    });
  });

  // ─── getPrompt ──────────────────────────────────────────────────────────

  describe('getPrompt', () => {
    it('shows "asklepios" for default resource', () => {
      const session: Session = { resourceId: DEFAULT_RESOURCE, threadId: 'x', networkMode: false };
      const prompt = getPrompt(session);
      expect(prompt).toContain('asklepios');
    });

    it('shows patient ID for patient resource', () => {
      const session: Session = { resourceId: 'patient-eds-001', threadId: 'x', networkMode: false };
      const prompt = getPrompt(session);
      expect(prompt).toContain('eds-001');
      expect(prompt).not.toContain('patient-');
    });

    it('includes ANSI color codes', () => {
      const session: Session = { resourceId: DEFAULT_RESOURCE, threadId: 'x', networkMode: false };
      const prompt = getPrompt(session);
      expect(prompt).toContain('\x1b[36m');
      expect(prompt).toContain('\x1b[0m');
    });

    it('shows [net] indicator when network mode is enabled', () => {
      const session: Session = { resourceId: DEFAULT_RESOURCE, threadId: 'x', networkMode: true };
      const prompt = getPrompt(session);
      expect(prompt).toContain('[net]');
    });

    it('does not show [net] indicator when network mode is disabled', () => {
      const session: Session = { resourceId: DEFAULT_RESOURCE, threadId: 'x', networkMode: false };
      const prompt = getPrompt(session);
      expect(prompt).not.toContain('[net]');
    });
  });

  // ─── getPatientInstructions ─────────────────────────────────────────────

  describe('getPatientInstructions', () => {
    it('returns instructions for patient sessions', () => {
      const session: Session = { resourceId: 'patient-eds-01', threadId: 'x', networkMode: false };
      const instructions = getPatientInstructions(session);
      expect(instructions).toBeDefined();
      expect(instructions).toContain('eds-01');
    });

    it('returns undefined for default resource', () => {
      const session: Session = { resourceId: DEFAULT_RESOURCE, threadId: 'x', networkMode: false };
      expect(getPatientInstructions(session)).toBeUndefined();
    });

    it('returns undefined for non-patient resources', () => {
      const session: Session = { resourceId: 'custom-resource', threadId: 'x', networkMode: false };
      expect(getPatientInstructions(session)).toBeUndefined();
    });

    it('extracts complex patient IDs correctly', () => {
      const session: Session = {
        resourceId: 'patient-marfan-42',
        threadId: 'x',
        networkMode: false,
      };
      const instructions = getPatientInstructions(session);
      expect(instructions).toContain('marfan-42');
    });
  });

  // ─── parseArgs ──────────────────────────────────────────────────────────

  describe('parseArgs', () => {
    it('parses --patient flag', () => {
      const result = parseArgs(['--patient', 'eds-001']);
      expect(result.patientId).toBe('eds-001');
    });

    it('parses -p shorthand', () => {
      const result = parseArgs(['-p', 'eds-001']);
      expect(result.patientId).toBe('eds-001');
    });

    it('returns undefined when no patient flag', () => {
      const result = parseArgs([]);
      expect(result.patientId).toBeUndefined();
    });

    it('ignores --patient without value', () => {
      const result = parseArgs(['--patient']);
      expect(result.patientId).toBeUndefined();
    });
  });
});
