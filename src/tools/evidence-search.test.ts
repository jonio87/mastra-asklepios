import { evidenceSearchTool } from './evidence-search.js';

describe('evidenceSearchTool', () => {
  it('has correct tool configuration', () => {
    expect(evidenceSearchTool.id).toBe('evidence-search');
    expect(evidenceSearchTool.description).toBeDefined();
    expect(evidenceSearchTool.inputSchema).toBeDefined();
    expect(evidenceSearchTool.outputSchema).toBeDefined();
    expect(evidenceSearchTool.execute).toBeDefined();
  });

  it('validates free-text query', () => {
    const result = evidenceSearchTool.inputSchema.safeParse({
      query: 'low dose naltrexone chronic pain',
    });
    expect(result.success).toBe(true);
  });

  it('validates PICO-structured query', () => {
    const result = evidenceSearchTool.inputSchema.safeParse({
      population: 'chronic craniofacial pain',
      intervention: 'greater occipital nerve block',
      comparison: 'placebo',
      outcome: 'pain reduction',
    });
    expect(result.success).toBe(true);
  });

  it('validates evidence type filter', () => {
    const result = evidenceSearchTool.inputSchema.safeParse({
      query: 'ketamine headache',
      evidenceTypes: ['systematic-review', 'rct'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid evidence type', () => {
    const result = evidenceSearchTool.inputSchema.safeParse({
      query: 'test',
      evidenceTypes: ['invalid-type'],
    });
    expect(result.success).toBe(false);
  });

  it('validates output schema', () => {
    const result = evidenceSearchTool.outputSchema.safeParse({
      results: [
        {
          title: 'GON blocks for migraine: a systematic review',
          source: 'cochrane',
          evidenceLevel: 'systematic-review',
          authors: ['Smith J', 'Doe A'],
          journal: 'Cochrane Database of Systematic Reviews',
          publicationDate: '2024',
          pmid: '12345678',
          abstract: 'Background: ...',
          url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
        },
      ],
      totalByType: { cochrane: 1 },
      query: 'GON block migraine',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty input', () => {
    const result = evidenceSearchTool.inputSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
