import { parallelResearchTool } from './parallel-research.js';

describe('parallel-research tool', () => {
  it('has correct tool id and description', () => {
    expect(parallelResearchTool.id).toBe('parallel-research');
    expect(parallelResearchTool.description).toContain('Parallel.ai');
    expect(parallelResearchTool.description).toContain('deep research');
  });

  it('has correct input schema with role enum', () => {
    const schema = parallelResearchTool.inputSchema;
    expect(schema).toBeDefined();

    // Valid input with role
    const withRole = schema?.safeParse({
      query: 'Sjögren syndrome trigeminal neuropathy mechanisms',
      role: 'advocate',
    });
    expect(withRole?.success).toBe(true);

    // Valid input without role
    const withoutRole = schema?.safeParse({
      query: 'Sjögren syndrome trigeminal neuropathy mechanisms',
    });
    expect(withoutRole?.success).toBe(true);

    // All role values
    for (const role of ['advocate', 'skeptic', 'unbiased'] as const) {
      const valid = schema?.safeParse({ query: 'test', role });
      expect(valid?.success).toBe(true);
    }

    // Invalid role
    const invalidRole = schema?.safeParse({
      query: 'test',
      role: 'neutral',
    });
    expect(invalidRole?.success).toBe(false);
  });

  it('accepts optional context and processor fields', () => {
    const schema = parallelResearchTool.inputSchema;

    const full = schema?.safeParse({
      query: 'test query',
      context: 'Patient has chronic facial pain',
      processor: 'ultra',
      role: 'skeptic',
    });
    expect(full?.success).toBe(true);

    // All processor values
    for (const processor of ['base', 'core', 'ultra'] as const) {
      const valid = schema?.safeParse({ query: 'test', processor });
      expect(valid?.success).toBe(true);
    }
  });

  it('requires query field', () => {
    const schema = parallelResearchTool.inputSchema;

    const missingQuery = schema?.safeParse({
      role: 'advocate',
    });
    expect(missingQuery?.success).toBe(false);
  });

  it('has correct output schema fields', () => {
    const schema = parallelResearchTool.outputSchema;
    expect(schema).toBeDefined();

    const valid = schema?.safeParse({
      report: 'Research report markdown',
      sources: [{ url: 'https://example.com', title: 'Source', excerpt: 'Excerpt' }],
      processor: 'ultra',
      durationMs: 120000,
      available: true,
    });
    expect(valid?.success).toBe(true);
  });
});
