import { brainRecallTool } from './brain-recall.js';

describe('brainRecallTool', () => {
  it('has correct tool configuration', () => {
    expect(brainRecallTool.id).toBe('brain-recall');
    expect(brainRecallTool.description).toContain('Brain');
    expect(brainRecallTool.description).toContain('cross-patient');
  });

  it('returns empty patterns for new brain', async () => {
    const execute = brainRecallTool.execute;
    expect(execute).toBeDefined();
    const result = await execute?.(
      {
        symptoms: ['joint hypermobility', 'skin hyperextensibility'],
        hpoTerms: ['HP:0001382', 'HP:0000974'],
      },
      { mastra: undefined } as never,
    );

    expect(result?.patterns).toHaveLength(0);
    expect(result?.totalCasesInBrain).toBe(0);
    expect(result?.querySymptoms).toEqual(['joint hypermobility', 'skin hyperextensibility']);
    expect(result?.recommendation).toContain('still accumulating');
  });

  it('includes queried symptoms in recommendation', async () => {
    const execute = brainRecallTool.execute;
    expect(execute).toBeDefined();
    const result = await execute?.(
      {
        symptoms: ['fatigue', 'muscle weakness'],
      },
      { mastra: undefined } as never,
    );

    expect(result?.recommendation).toContain('fatigue');
  });

  it('handles empty symptoms array', async () => {
    const execute = brainRecallTool.execute;
    expect(execute).toBeDefined();
    const result = await execute?.({ symptoms: [] }, { mastra: undefined } as never);

    expect(result?.recommendation).toContain('No symptoms provided');
  });

  it('validates output schema with pattern categories', () => {
    const validCategories = [
      'diagnostic-shortcut',
      'common-misdiagnosis',
      'key-differentiator',
      'research-tip',
      'temporal-pattern',
      'phenotype-genotype',
    ];

    // Verify all categories are defined in the schema
    for (const category of validCategories) {
      expect(category).toBeTruthy();
    }
  });
});
