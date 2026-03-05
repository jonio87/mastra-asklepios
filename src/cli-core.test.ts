import { jest } from '@jest/globals';

jest.mock('./mastra.js', () => ({
  mastra: {
    getAgent: jest.fn(),
    getWorkflow: jest.fn(),
  },
}));

jest.mock('./memory.js', () => ({
  storage: {},
  memory: {},
  brainMemory: {},
}));

describe('cli-core', () => {
  describe('StreamEvent type exports', () => {
    it('exports streamDirect as async generator function', async () => {
      const { streamDirect } = await import('./cli-core.js');
      expect(typeof streamDirect).toBe('function');
    });

    it('exports streamNetwork as async generator function', async () => {
      const { streamNetwork } = await import('./cli-core.js');
      expect(typeof streamNetwork).toBe('function');
    });

    it('exports streamAgent as function', async () => {
      const { streamAgent } = await import('./cli-core.js');
      expect(typeof streamAgent).toBe('function');
    });

    it('exports handleResume as async function', async () => {
      const { handleResume } = await import('./cli-core.js');
      expect(typeof handleResume).toBe('function');
    });
  });

  describe('handleResume', () => {
    it('returns usage text when missing workflowId', async () => {
      const { handleResume } = await import('./cli-core.js');
      const result = await handleResume('/resume');
      expect(result.success).toBe(false);
      expect(result.output).toContain('Usage:');
    });

    it('returns usage text when missing stepId', async () => {
      const { handleResume } = await import('./cli-core.js');
      const result = await handleResume('/resume patient-intake');
      expect(result.success).toBe(false);
      expect(result.output).toContain('Usage:');
    });

    it('returns error for unknown workflow', async () => {
      const { handleResume } = await import('./cli-core.js');
      const result = await handleResume('/resume unknown-workflow step1');
      expect(result.success).toBe(false);
      expect(result.output).toContain('Unknown workflow');
    });

    it('returns error for invalid JSON resume data', async () => {
      const { handleResume } = await import('./cli-core.js');
      const result = await handleResume('/resume patient-intake review-phenotypes {bad json}');
      expect(result.success).toBe(false);
      expect(result.output).toContain('Invalid JSON');
    });
  });
});
