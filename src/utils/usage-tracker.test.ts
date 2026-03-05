import type { TokenUsage } from './usage-tracker.js';
import {
  createSessionUsage,
  formatSessionUsage,
  formatUsage,
  recordUsage,
} from './usage-tracker.js';

describe('usage-tracker', () => {
  describe('createSessionUsage', () => {
    it('creates empty session usage', () => {
      const session = createSessionUsage();
      expect(session.interactions).toBe(0);
      expect(session.totals.inputTokens).toBe(0);
      expect(session.totals.outputTokens).toBe(0);
      expect(session.totals.totalTokens).toBe(0);
      expect(session.history).toHaveLength(0);
    });
  });

  describe('recordUsage', () => {
    it('accumulates token counts', () => {
      const session = createSessionUsage();
      const usage: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      recordUsage(session, usage);
      expect(session.interactions).toBe(1);
      expect(session.totals.inputTokens).toBe(100);
      expect(session.totals.outputTokens).toBe(50);
      expect(session.totals.totalTokens).toBe(150);
      expect(session.history).toHaveLength(1);
    });

    it('accumulates across multiple interactions', () => {
      const session = createSessionUsage();
      recordUsage(session, { inputTokens: 100, outputTokens: 50, totalTokens: 150 });
      recordUsage(session, { inputTokens: 200, outputTokens: 80, totalTokens: 280 });

      expect(session.interactions).toBe(2);
      expect(session.totals.inputTokens).toBe(300);
      expect(session.totals.outputTokens).toBe(130);
      expect(session.totals.totalTokens).toBe(430);
      expect(session.history).toHaveLength(2);
    });

    it('handles undefined token counts', () => {
      const session = createSessionUsage();
      recordUsage(session, {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      });

      expect(session.interactions).toBe(1);
      expect(session.totals.inputTokens).toBe(0);
      expect(session.totals.outputTokens).toBe(0);
      expect(session.totals.totalTokens).toBe(0);
    });

    it('tracks reasoning and cached tokens', () => {
      const session = createSessionUsage();
      recordUsage(session, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 200,
        reasoningTokens: 50,
        cachedInputTokens: 30,
      });

      expect(session.totals.reasoningTokens).toBe(50);
      expect(session.totals.cachedInputTokens).toBe(30);
    });
  });

  describe('formatUsage', () => {
    it('formats token counts', () => {
      const result = formatUsage({
        inputTokens: 1234,
        outputTokens: 567,
        totalTokens: 1801,
      });
      expect(result).toContain('1,234 in');
      expect(result).toContain('567 out');
      expect(result).toContain('1,801 total');
    });

    it('handles undefined counts as zero', () => {
      const result = formatUsage({
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      });
      expect(result).toContain('0 in');
      expect(result).toContain('0 out');
      expect(result).toContain('0 total');
    });
  });

  describe('formatSessionUsage', () => {
    it('formats empty session', () => {
      const session = createSessionUsage();
      const result = formatSessionUsage(session);
      expect(result).toContain('0 interactions');
      expect(result).toContain('Input:');
      expect(result).toContain('Output:');
      expect(result).toContain('Total:');
    });

    it('formats session with interactions', () => {
      const session = createSessionUsage();
      recordUsage(session, { inputTokens: 500, outputTokens: 200, totalTokens: 700 });
      recordUsage(session, { inputTokens: 300, outputTokens: 150, totalTokens: 450 });

      const result = formatSessionUsage(session);
      expect(result).toContain('2 interactions');
      expect(result).toContain('800');
      expect(result).toContain('350');
      expect(result).toContain('1,150');
      expect(result).toContain('Last turn:');
    });

    it('uses singular for one interaction', () => {
      const session = createSessionUsage();
      recordUsage(session, { inputTokens: 100, outputTokens: 50, totalTokens: 150 });

      const result = formatSessionUsage(session);
      expect(result).toContain('1 interaction)');
      expect(result).not.toContain('interactions');
    });

    it('includes cached tokens when present', () => {
      const session = createSessionUsage();
      recordUsage(session, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cachedInputTokens: 40,
      });

      const result = formatSessionUsage(session);
      expect(result).toContain('Cached:');
    });

    it('includes reasoning tokens when present', () => {
      const session = createSessionUsage();
      recordUsage(session, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 200,
        reasoningTokens: 50,
      });

      const result = formatSessionUsage(session);
      expect(result).toContain('Reasoning:');
    });
  });
});
