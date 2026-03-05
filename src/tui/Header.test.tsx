import { jest } from '@jest/globals';
import { render } from 'ink-testing-library';
import { createSessionUsage } from '../utils/usage-tracker.js';
import { Header } from './Header.js';

jest.mock('../mastra.js', () => ({
  mastra: {
    getAgent: jest.fn(),
    getWorkflow: jest.fn(),
  },
}));

jest.mock('../memory.js', () => ({
  storage: {},
  memory: {},
  brainMemory: {},
}));

describe('Header', () => {
  const baseSession = {
    resourceId: 'patient-maria-kowalski',
    threadId: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
    networkMode: false,
  };

  it('renders patient name from resourceId', () => {
    const { lastFrame } = render(
      <Header session={baseSession} sessionUsage={createSessionUsage()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('maria-kowalski');
  });

  it('renders truncated thread ID', () => {
    const { lastFrame } = render(
      <Header session={baseSession} sessionUsage={createSessionUsage()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('aaaabbbb');
  });

  it('shows DIRECT mode by default', () => {
    const { lastFrame } = render(
      <Header session={baseSession} sessionUsage={createSessionUsage()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[DIRECT]');
  });

  it('shows NET mode when networkMode is true', () => {
    const netSession = { ...baseSession, networkMode: true };
    const { lastFrame } = render(
      <Header session={netSession} sessionUsage={createSessionUsage()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[NET]');
  });

  it('shows asklepios when no patient context', () => {
    const defaultSession = {
      ...baseSession,
      resourceId: 'asklepios-knowledge',
    };
    const { lastFrame } = render(
      <Header session={defaultSession} sessionUsage={createSessionUsage()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('asklepios');
  });

  it('shows token usage from sessionUsage', () => {
    const usage = createSessionUsage();
    usage.totals.inputTokens = 1234;
    usage.totals.outputTokens = 567;
    const { lastFrame } = render(<Header session={baseSession} sessionUsage={usage} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('1,234');
    expect(frame).toContain('567');
  });

  it('renders Asklepios title', () => {
    const { lastFrame } = render(
      <Header session={baseSession} sessionUsage={createSessionUsage()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Asklepios');
  });
});
