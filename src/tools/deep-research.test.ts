import { jest } from '@jest/globals';

// Mock the biomedical MCP client before importing the tool
jest.mock('../clients/biomedical-mcp.js', () => ({
  getBiomedicalTools: jest.fn(() => Promise.resolve({})),
}));

jest.mock('../utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('deepResearchTool', () => {
  it('has correct tool configuration', async () => {
    const { deepResearchTool } = await import('./deep-research.js');
    expect(deepResearchTool.id).toBe('deep-research');
    expect(deepResearchTool.description).toBeDefined();
    expect(deepResearchTool.inputSchema).toBeDefined();
    expect(deepResearchTool.outputSchema).toBeDefined();
    expect(deepResearchTool.execute).toBeDefined();
  });

  it('validates valid input with query only', async () => {
    const { deepResearchTool } = await import('./deep-research.js');
    const result = deepResearchTool.inputSchema.safeParse({
      query: 'Ehlers-Danlos Syndrome hypermobility type',
    });
    expect(result.success).toBe(true);
  });

  it('validates input with all optional fields', async () => {
    const { deepResearchTool } = await import('./deep-research.js');
    const result = deepResearchTool.inputSchema.safeParse({
      query: 'rare connective tissue disorder',
      context: 'Patient is 25-year-old female with joint hypermobility',
      focusAreas: ['genetics', 'treatment'],
      maxSources: 15,
    });
    expect(result.success).toBe(true);
  });

  it('rejects maxSources above 100', async () => {
    const { deepResearchTool } = await import('./deep-research.js');
    const result = deepResearchTool.inputSchema.safeParse({
      query: 'test',
      maxSources: 200,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing query', async () => {
    const { deepResearchTool } = await import('./deep-research.js');
    const result = deepResearchTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('validates output schema with valid research report', async () => {
    const { deepResearchTool } = await import('./deep-research.js');
    const result = deepResearchTool.outputSchema.safeParse({
      query: 'test query',
      findings: [
        {
          source: 'PubMed',
          title: 'A case report',
          summary: 'Case report findings',
          relevance: 0.8,
          url: 'https://example.com',
          evidenceLevel: 'case-report',
        },
      ],
      synthesis: 'The research reveals...',
      gaps: ['Limited RCT data'],
      suggestedFollowUp: ['Search for genetic studies'],
      timestamp: '2026-03-05T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('validates all evidence level types', async () => {
    const { deepResearchTool } = await import('./deep-research.js');
    const levels = [
      'case-report',
      'case-series',
      'cohort',
      'rct',
      'meta-analysis',
      'review',
      'expert-opinion',
      'unknown',
    ] as const;

    for (const level of levels) {
      const result = deepResearchTool.outputSchema.safeParse({
        query: 'test',
        findings: [
          {
            source: 'Test',
            title: 'Test',
            summary: 'Test',
            relevance: 0.5,
            evidenceLevel: level,
          },
        ],
        synthesis: 'test',
        gaps: [],
        suggestedFollowUp: [],
        timestamp: '2026-03-05T00:00:00.000Z',
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid evidence level', async () => {
    const { deepResearchTool } = await import('./deep-research.js');
    const result = deepResearchTool.outputSchema.safeParse({
      query: 'test',
      findings: [
        {
          source: 'Test',
          title: 'Test',
          summary: 'Test',
          relevance: 0.5,
          evidenceLevel: 'not-a-valid-level',
        },
      ],
      synthesis: 'test',
      gaps: [],
      suggestedFollowUp: [],
      timestamp: '2026-03-05T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects relevance score outside 0-1 range', async () => {
    const { deepResearchTool } = await import('./deep-research.js');
    const result = deepResearchTool.outputSchema.safeParse({
      query: 'test',
      findings: [
        {
          source: 'Test',
          title: 'Test',
          summary: 'Test',
          relevance: 1.5,
          evidenceLevel: 'unknown',
        },
      ],
      synthesis: 'test',
      gaps: [],
      suggestedFollowUp: [],
      timestamp: '2026-03-05T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});
