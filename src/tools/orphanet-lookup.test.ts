import { orphanetLookupTool } from './orphanet-lookup.js';

describe('orphanetLookupTool', () => {
  it('has correct tool configuration', () => {
    expect(orphanetLookupTool.id).toBe('orphanet-lookup');
    expect(orphanetLookupTool.description).toBeDefined();
    expect(orphanetLookupTool.inputSchema).toBeDefined();
    expect(orphanetLookupTool.outputSchema).toBeDefined();
    expect(orphanetLookupTool.execute).toBeDefined();
  });

  it('validates valid input with query only', () => {
    const result = orphanetLookupTool.inputSchema.safeParse({
      query: 'Ehlers-Danlos',
    });
    expect(result.success).toBe(true);
  });

  it('validates input with orphaCode', () => {
    const result = orphanetLookupTool.inputSchema.safeParse({
      query: 'test',
      orphaCode: 287,
    });
    expect(result.success).toBe(true);
  });

  it('validates input with maxResults', () => {
    const result = orphanetLookupTool.inputSchema.safeParse({
      query: 'test',
      maxResults: 10,
    });
    expect(result.success).toBe(true);
  });

  it('rejects maxResults above 20', () => {
    const result = orphanetLookupTool.inputSchema.safeParse({
      query: 'test',
      maxResults: 25,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing query', () => {
    const result = orphanetLookupTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('validates output schema with valid disease data', () => {
    const result = orphanetLookupTool.outputSchema.safeParse({
      diseases: [
        {
          orphaNumber: 287,
          name: 'Ehlers-Danlos Syndrome',
          definition: 'A group of heritable connective tissue disorders',
          genes: [{ symbol: 'COL5A1', name: 'Collagen Type V Alpha 1 Chain' }],
          synonyms: ['EDS'],
          url: 'https://www.orpha.net/en/disease/detail/287',
        },
      ],
      query: 'Ehlers-Danlos',
    });
    expect(result.success).toBe(true);
  });

  it('validates output with optional fields', () => {
    const result = orphanetLookupTool.outputSchema.safeParse({
      diseases: [
        {
          orphaNumber: 287,
          name: 'EDS',
          definition: 'A connective tissue disorder',
          prevalence: '1/5000',
          inheritanceMode: 'Autosomal dominant',
          ageOfOnset: 'Childhood',
          genes: [],
          synonyms: [],
          url: 'https://www.orpha.net/en/disease/detail/287',
        },
      ],
      query: 'test',
    });
    expect(result.success).toBe(true);
  });

  it('validates empty diseases array', () => {
    const result = orphanetLookupTool.outputSchema.safeParse({
      diseases: [],
      query: 'nonexistent disease xyz123',
    });
    expect(result.success).toBe(true);
  });
});
