import type { MastraDBMessage } from '@mastra/core/agent';
import type { ProcessInputArgs } from '@mastra/core/processors';
import { medicalDisclaimerProcessor } from './medical-disclaimer.js';

function makeMessage(role: 'user' | 'assistant', text: string): MastraDBMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role,
    createdAt: new Date(),
    content: {
      format: 2 as const,
      parts: [{ type: 'text' as const, text }],
    },
  };
}

function makeArgs(
  messages: MastraDBMessage[],
  systemMessages: Array<{ role: 'system'; content: string }> = [],
): ProcessInputArgs {
  return {
    messages,
    systemMessages,
    state: {},
    abort: () => {
      throw new Error('aborted');
    },
    retryCount: 0,
    messageList: {} as ProcessInputArgs['messageList'],
  };
}

describe('medicalDisclaimerProcessor', () => {
  it('has correct processor configuration', () => {
    expect(medicalDisclaimerProcessor.id).toBe('medical-disclaimer');
    expect(medicalDisclaimerProcessor.name).toBe('Medical Disclaimer');
  });

  it('injects disclaimer into system messages when missing', () => {
    const messages = [makeMessage('user', 'What rare diseases match these symptoms?')];
    const result = medicalDisclaimerProcessor.processInput!(makeArgs(messages));

    expect(result).toHaveProperty('systemMessages');
    const { systemMessages } = result as { systemMessages: Array<{ content: string }> };
    const disclaimerMsg = systemMessages.find(
      (m) => typeof m.content === 'string' && m.content.includes('RESEARCH PURPOSES ONLY'),
    );
    expect(disclaimerMsg).toBeDefined();
  });

  it('does not duplicate disclaimer when already present', () => {
    const messages = [makeMessage('user', 'What rare diseases match these symptoms?')];
    const existing = [
      {
        role: 'system' as const,
        content: 'IMPORTANT: You are a research assistant... RESEARCH PURPOSES ONLY ...',
      },
    ];
    const result = medicalDisclaimerProcessor.processInput!(makeArgs(messages, existing));

    const { systemMessages } = result as { systemMessages: Array<{ content: string }> };
    expect(systemMessages).toHaveLength(1);
  });

  it('preserves existing system messages when adding disclaimer', () => {
    const messages = [makeMessage('user', 'Help me research EDS')];
    const existing = [{ role: 'system' as const, content: 'You are Asklepios.' }];
    const result = medicalDisclaimerProcessor.processInput!(makeArgs(messages, existing));

    const { systemMessages } = result as { systemMessages: Array<{ content: string }> };
    expect(systemMessages).toHaveLength(2);
    expect(systemMessages[0]?.content).toBe('You are Asklepios.');
  });

  it('passes through messages unchanged', () => {
    const messages = [makeMessage('user', 'Patient has joint hypermobility')];
    const result = medicalDisclaimerProcessor.processInput!(makeArgs(messages));

    const { messages: resultMessages } = result as { messages: MastraDBMessage[] };
    expect(resultMessages).toBe(messages);
  });
});
