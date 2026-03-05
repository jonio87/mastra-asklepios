import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { resolveMaxSteps } from './max-steps.js';

describe('resolveMaxSteps', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['ASKLEPIOS_MAX_STEPS'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('env var override', () => {
    it('uses ASKLEPIOS_MAX_STEPS when set', () => {
      process.env['ASKLEPIOS_MAX_STEPS'] = '12';
      expect(resolveMaxSteps('hello')).toBe(12);
    });

    it('clamps env var to minimum 3', () => {
      process.env['ASKLEPIOS_MAX_STEPS'] = '1';
      expect(resolveMaxSteps('hello')).toBe(3);
    });

    it('clamps env var to maximum 25', () => {
      process.env['ASKLEPIOS_MAX_STEPS'] = '50';
      expect(resolveMaxSteps('hello')).toBe(25);
    });

    it('ignores non-numeric env var', () => {
      process.env['ASKLEPIOS_MAX_STEPS'] = 'abc';
      // Falls through to heuristic — "hello" is short → 5
      expect(resolveMaxSteps('hello')).toBe(5);
    });
  });

  describe('simple chat (5 steps)', () => {
    it('returns 5 for short greetings', () => {
      expect(resolveMaxSteps('hello')).toBe(5);
    });

    it('returns 5 for short questions', () => {
      expect(resolveMaxSteps('what can you do?')).toBe(5);
    });

    it('returns 5 for status checks', () => {
      expect(resolveMaxSteps('how are you?')).toBe(5);
    });
  });

  describe('standard query (10 steps)', () => {
    it('returns 10 for symptom descriptions longer than 50 chars', () => {
      expect(
        resolveMaxSteps('I have been experiencing joint pain and fatigue for several months now'),
      ).toBe(10);
    });

    it('returns 10 for longer medical questions', () => {
      expect(
        resolveMaxSteps(
          'Can you tell me about Ehlers-Danlos syndrome and what symptoms to look for in my case?',
        ),
      ).toBe(10);
    });
  });

  describe('complex research (15 steps)', () => {
    it('returns 15 for research queries', () => {
      expect(resolveMaxSteps('research COL3A1 gene mutations')).toBe(15);
    });

    it('returns 15 for variant analysis', () => {
      expect(resolveMaxSteps('analyze variant c.1854+1G>A')).toBe(15);
    });

    it('returns 15 for differential diagnosis', () => {
      expect(resolveMaxSteps('generate a differential diagnosis')).toBe(15);
    });

    it('returns 15 for investigate queries', () => {
      expect(resolveMaxSteps('investigate these symptoms')).toBe(15);
    });

    it('returns 15 for compare queries', () => {
      expect(resolveMaxSteps('compare vEDS and cEDS')).toBe(15);
    });
  });

  describe('deep diagnostic (20 steps)', () => {
    it('returns 20 for comprehensive queries', () => {
      expect(resolveMaxSteps('comprehensive analysis of my symptoms')).toBe(20);
    });

    it('returns 20 for deep dive requests', () => {
      expect(resolveMaxSteps('deep dive into COL3A1')).toBe(20);
    });

    it('returns 20 for full workup requests', () => {
      expect(resolveMaxSteps('full workup for connective tissue disorders')).toBe(20);
    });

    it('returns 20 for exhaustive analysis', () => {
      expect(resolveMaxSteps('exhaustive review of evidence')).toBe(20);
    });

    it('deep keywords take priority over complex keywords', () => {
      // Contains both "research" (complex) and "comprehensive" (deep)
      expect(resolveMaxSteps('comprehensive research into genetic markers')).toBe(20);
    });
  });
});
