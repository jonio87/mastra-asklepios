import type { MastraDBMessage } from '@mastra/core/agent';
import type { ProcessOutputResultArgs } from '@mastra/core/processors';
import { evidenceQualityProcessor } from './evidence-quality.js';

function makeMessage(role: 'user' | 'assistant', text: string): MastraDBMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role,
    createdAt: new Date(),
    content: {
      format: 2 as const,
      parts: [{ type: 'text' as const, text }],
      content: text,
    },
  };
}

function makeOutputArgs(messages: MastraDBMessage[]): ProcessOutputResultArgs {
  return {
    messages,
    state: {},
    abort: () => {
      throw new Error('aborted');
    },
    retryCount: 0,
    messageList: {} as ProcessOutputResultArgs['messageList'],
  };
}

describe('evidenceQualityProcessor', () => {
  it('has correct processor configuration', () => {
    expect(evidenceQualityProcessor.id).toBe('evidence-quality');
    expect(evidenceQualityProcessor.name).toBe('Evidence Quality Monitor');
  });

  it('passes through non-diagnostic messages unchanged', () => {
    const messages = [
      makeMessage('user', 'Hello'),
      makeMessage('assistant', 'Hi! How can I help you today?'),
    ];
    const processOutput = evidenceQualityProcessor.processOutputResult;
    expect(processOutput).toBeDefined();
    const result = processOutput?.(makeOutputArgs(messages));
    expect(result).toEqual(messages);
  });

  it('passes through messages with no assistant response', () => {
    const messages = [makeMessage('user', 'What is EDS?')];
    const processOutput = evidenceQualityProcessor.processOutputResult;
    expect(processOutput).toBeDefined();
    const result = processOutput?.(makeOutputArgs(messages));
    expect(result).toEqual(messages);
  });

  it('appends citation reminder when diagnostic content lacks citations', () => {
    const messages = [
      makeMessage('user', 'What could this be?'),
      makeMessage(
        'assistant',
        'Based on these symptoms, the diagnosis may indicate Ehlers-Danlos Syndrome.',
      ),
    ];
    const processOutput = evidenceQualityProcessor.processOutputResult;
    expect(processOutput).toBeDefined();
    const result = processOutput?.(makeOutputArgs(messages)) as MastraDBMessage[] | undefined;

    const lastMsg = result?.[result.length - 1];
    expect(lastMsg).toBeDefined();

    const lastPart = lastMsg?.content.parts[lastMsg.content.parts.length - 1];
    expect(lastPart).toBeDefined();
    if (lastPart && 'text' in lastPart) {
      expect(lastPart.text).toContain('evidence citations');
    }
  });

  it('does not append reminder when diagnostic content has citations', () => {
    const messages = [
      makeMessage('user', 'What could this be?'),
      makeMessage('assistant', 'The diagnosis suggests EDS (PMID: 12345678). Confidence: 85%.'),
    ];
    const processOutput = evidenceQualityProcessor.processOutputResult;
    expect(processOutput).toBeDefined();
    const result = processOutput?.(makeOutputArgs(messages)) as MastraDBMessage[] | undefined;

    const lastMsg = result?.[result.length - 1];
    expect(lastMsg).toBeDefined();
    // Should not have appended any new parts
    expect(lastMsg?.content.parts).toHaveLength(1);
  });

  it('appends low confidence warning when confidence is below threshold', () => {
    const messages = [
      makeMessage('user', 'What is the diagnosis?'),
      makeMessage(
        'assistant',
        'The diagnosis may indicate Marfan Syndrome. Confidence: 15%. PMID: 99999.',
      ),
    ];
    const processOutput = evidenceQualityProcessor.processOutputResult;
    expect(processOutput).toBeDefined();
    const result = processOutput?.(makeOutputArgs(messages)) as MastraDBMessage[] | undefined;

    const lastMsg = result?.[result.length - 1];
    expect(lastMsg).toBeDefined();

    const appendedPart = lastMsg?.content.parts[lastMsg.content.parts.length - 1];
    expect(appendedPart).toBeDefined();
    if (appendedPart && 'text' in appendedPart) {
      expect(appendedPart.text).toContain('Low Confidence Alert');
      expect(appendedPart.text).toContain('rare disease specialist');
    }
  });

  it('does not warn when confidence is above threshold', () => {
    const messages = [
      makeMessage('user', 'Diagnosis?'),
      makeMessage(
        'assistant',
        'The diagnosis is consistent with EDS type III. Confidence: 75%. PMID: 11111.',
      ),
    ];
    const processOutput = evidenceQualityProcessor.processOutputResult;
    expect(processOutput).toBeDefined();
    const result = processOutput?.(makeOutputArgs(messages)) as MastraDBMessage[] | undefined;

    const lastMsg = result?.[result.length - 1];
    expect(lastMsg?.content.parts).toHaveLength(1);
  });
});
