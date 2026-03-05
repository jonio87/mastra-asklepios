import { describe, expect, it, jest } from '@jest/globals';
import { render } from 'ink-testing-library';
import { App } from './App.js';

// Mock the heavy dependencies so the component renders without real agent calls
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

describe('App', () => {
  it('renders Asklepios header', () => {
    const { lastFrame } = render(<App />);
    const frame = lastFrame();
    expect(frame).toContain('Asklepios');
  });

  it('shows DIRECT mode by default', () => {
    const { lastFrame } = render(<App />);
    expect(lastFrame()).toContain('[DIRECT]');
  });

  it('shows help hint when no messages', () => {
    const { lastFrame } = render(<App />);
    expect(lastFrame()).toContain('Type a message');
    expect(lastFrame()).toContain('/help');
  });

  it('shows patient label when patientId provided', () => {
    const { lastFrame } = render(<App patientId="maria-kowalski" />);
    expect(lastFrame()).toContain('maria-kowalski');
  });

  it('shows asklepios label when no patient', () => {
    const { lastFrame } = render(<App />);
    expect(lastFrame()).toContain('asklepios');
  });

  it('renders input bar with prompt', () => {
    const { lastFrame } = render(<App />);
    const frame = lastFrame();
    // Input bar should show the prompt
    expect(frame).toContain('>');
  });

  it('renders complete layout with all sections', () => {
    const { lastFrame } = render(<App patientId="maria-kowalski" />);
    const frame = lastFrame() ?? '';

    // Header
    expect(frame).toContain('Asklepios');
    expect(frame).toContain('maria-kowalski');
    expect(frame).toContain('[DIRECT]');

    // Help hint (no messages yet)
    expect(frame).toContain('Type a message');

    // Input bar
    expect(frame).toContain('>');
  });
});
