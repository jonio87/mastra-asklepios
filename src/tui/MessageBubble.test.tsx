import { describe, expect, it } from '@jest/globals';
import { render } from 'ink-testing-library';
import { MessageBubble } from './MessageBubble.js';
import type { Message } from './types.js';

describe('MessageBubble', () => {
  it('renders user message with You label', () => {
    const msg: Message = { id: 1, role: 'user', content: 'What is vEDS?' };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    const frame = lastFrame();
    expect(frame).toContain('You:');
    expect(frame).toContain('What is vEDS?');
  });

  it('renders assistant message with Asklepios label', () => {
    const msg: Message = {
      id: 2,
      role: 'assistant',
      content: 'vEDS is a connective tissue disorder.',
    };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    const frame = lastFrame();
    expect(frame).toContain('Asklepios');
    expect(frame).toContain('vEDS is a connective tissue disorder.');
  });

  it('renders system message as dim text', () => {
    const msg: Message = { id: 3, role: 'system', content: 'Patient set to maria-kowalski' };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    expect(lastFrame()).toContain('Patient set to maria-kowalski');
  });

  it('shows agent label for network mode messages', () => {
    const msg: Message = {
      id: 4,
      role: 'assistant',
      content: 'Research results',
      agentId: 'research-agent',
    };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    expect(lastFrame()).toContain('[research-agent]');
  });

  it('shows token usage when available', () => {
    const msg: Message = {
      id: 5,
      role: 'assistant',
      content: 'Analysis complete.',
      tokens: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        reasoningTokens: 0,
        cachedInputTokens: 0,
      },
    };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    const frame = lastFrame();
    expect(frame).toContain('1,000');
    expect(frame).toContain('500');
  });
});
