import { openfdaLookupTool } from './openfda-lookup.js';

describe('openfdaLookupTool', () => {
  it('has correct tool configuration', () => {
    expect(openfdaLookupTool.id).toBe('openfda-lookup');
    expect(openfdaLookupTool.description).toBeDefined();
    expect(openfdaLookupTool.inputSchema).toBeDefined();
    expect(openfdaLookupTool.outputSchema).toBeDefined();
    expect(openfdaLookupTool.execute).toBeDefined();
  });

  it('validates basic drug name search', () => {
    const result = openfdaLookupTool.inputSchema.safeParse({
      drugName: 'bupropion',
    });
    expect(result.success).toBe(true);
  });

  it('validates adverse events with reaction term', () => {
    const result = openfdaLookupTool.inputSchema.safeParse({
      drugName: 'bupropion',
      reactionTerm: 'leukopenia',
      mode: 'adverse-events',
    });
    expect(result.success).toBe(true);
  });

  it('validates label search mode', () => {
    const result = openfdaLookupTool.inputSchema.safeParse({
      drugName: 'naltrexone',
      mode: 'label',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid mode', () => {
    const result = openfdaLookupTool.inputSchema.safeParse({
      drugName: 'test',
      mode: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing drug name', () => {
    const result = openfdaLookupTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('validates output schema for adverse events', () => {
    const result = openfdaLookupTool.outputSchema.safeParse({
      drugName: 'bupropion',
      adverseEvents: [
        { term: 'Nausea', count: 5000 },
        { term: 'Leukopenia', count: 120 },
      ],
      specificReactionCount: 120,
      totalReports: 50000,
      query: 'bupropion + leukopenia (adverse events)',
    });
    expect(result.success).toBe(true);
  });

  it('validates output schema for labels', () => {
    const result = openfdaLookupTool.outputSchema.safeParse({
      drugName: 'naltrexone',
      labels: [
        {
          brandName: 'ReVia',
          genericName: 'naltrexone',
          warnings: 'Hepatotoxicity warning...',
          indications: 'For treatment of...',
        },
      ],
      query: 'naltrexone (labels)',
    });
    expect(result.success).toBe(true);
  });
});
