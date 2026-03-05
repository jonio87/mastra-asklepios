import { logger } from './logger.js';
import { traceOnFinish, traceOnStepFinish } from './observability.js';

describe('observability', () => {
  let written: string[];

  beforeEach(() => {
    written = [];
    logger.setOutput({
      write: (chunk: string) => {
        written.push(chunk);
        return true;
      },
    });
    logger.setLevel('debug');
  });

  describe('traceOnFinish', () => {
    it('logs a completion span with token usage', () => {
      const callback = traceOnFinish('run-123');

      callback({
        finishReason: 'stop',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      });

      expect(written).toHaveLength(1);
      expect(written[0]).toContain('agent.stream.finish');
      expect(written[0]).toContain('run-123');
      expect(written[0]).toContain('"finishReason":"stop"');
    });

    it('logs a completion span without usage', () => {
      const callback = traceOnFinish('run-456');

      callback({ finishReason: 'length' });

      expect(written).toHaveLength(1);
      expect(written[0]).toContain('agent.stream.finish');
      expect(written[0]).toContain('"finishReason":"length"');
    });

    it('includes durationMs in the span', () => {
      const callback = traceOnFinish('run-789');

      callback({ finishReason: 'stop' });

      expect(written[0]).toContain('durationMs');
    });
  });

  describe('traceOnStepFinish', () => {
    it('logs step completion with tool calls', () => {
      const callback = traceOnStepFinish('run-abc');

      callback({
        finishReason: 'tool-calls',
        toolCalls: [{ toolName: 'pubmedSearch', args: { query: 'EDS' } }],
      });

      expect(written).toHaveLength(1);
      expect(written[0]).toContain('agent.step.1');
      expect(written[0]).toContain('pubmedSearch');
      expect(written[0]).toContain('Trace: step with tool calls');
    });

    it('logs step completion without tool calls', () => {
      const callback = traceOnStepFinish('run-def');

      callback({ finishReason: 'stop' });

      expect(written).toHaveLength(1);
      expect(written[0]).toContain('agent.step.1');
      expect(written[0]).toContain('Trace: step complete');
    });

    it('increments step index across multiple calls', () => {
      const callback = traceOnStepFinish('run-ghi');

      callback({ finishReason: 'tool-calls' });
      callback({ finishReason: 'stop' });

      expect(written[0]).toContain('agent.step.1');
      expect(written[1]).toContain('agent.step.2');
    });

    it('includes token usage when provided', () => {
      const callback = traceOnStepFinish('run-jkl');

      callback({
        finishReason: 'stop',
        usage: {
          promptTokens: 200,
          completionTokens: 100,
          totalTokens: 300,
        },
      });

      expect(written[0]).toContain('"input":200');
      expect(written[0]).toContain('"output":100');
      expect(written[0]).toContain('"total":300');
    });
  });
});
