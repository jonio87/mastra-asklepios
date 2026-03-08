import { pubmedSearchTool } from './pubmed-search.js';

describe('pubmedSearchTool', () => {
  it('has correct tool configuration', () => {
    expect(pubmedSearchTool.id).toBe('pubmed-search');
    expect(pubmedSearchTool.description).toBeDefined();
    expect(pubmedSearchTool.inputSchema).toBeDefined();
    expect(pubmedSearchTool.outputSchema).toBeDefined();
    expect(pubmedSearchTool.execute).toBeDefined();
  });

  it('validates valid input with query only', () => {
    const result = pubmedSearchTool.inputSchema.safeParse({
      query: 'rare disease',
    });
    expect(result.success).toBe(true);
  });

  it('validates input with maxResults', () => {
    const result = pubmedSearchTool.inputSchema.safeParse({
      query: 'Ehlers-Danlos Syndrome',
      maxResults: 5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects maxResults above 50', () => {
    const result = pubmedSearchTool.inputSchema.safeParse({
      query: 'test',
      maxResults: 100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects maxResults below 1', () => {
    const result = pubmedSearchTool.inputSchema.safeParse({
      query: 'test',
      maxResults: 0,
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty input for PMID-only modes', () => {
    const result = pubmedSearchTool.inputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('validates PMID lookup input', () => {
    const result = pubmedSearchTool.inputSchema.safeParse({
      pmid: '18549410',
    });
    expect(result.success).toBe(true);
  });

  it('validates batch PMID lookup input', () => {
    const result = pubmedSearchTool.inputSchema.safeParse({
      pmids: ['18549410', '34312221', '28025837'],
    });
    expect(result.success).toBe(true);
  });

  it('validates citedBy lookup input', () => {
    const result = pubmedSearchTool.inputSchema.safeParse({
      citedByPmid: '18549410',
    });
    expect(result.success).toBe(true);
  });

  it('validates output schema with full article data', () => {
    const result = pubmedSearchTool.outputSchema.safeParse({
      articles: [
        {
          pmid: '12345678',
          title: 'A study on rare diseases',
          abstract: 'This study examines...',
          authors: ['Smith J', 'Doe A'],
          journal: 'Nature',
          publicationDate: '2026-01',
          url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
          meshTerms: ['Headache', 'Trigeminal Nerve'],
          publicationType: ['Journal Article', 'Review'],
        },
      ],
      totalCount: 1,
      query: 'rare disease',
    });
    expect(result.success).toBe(true);
  });

  it('validates output with optional fields omitted', () => {
    const result = pubmedSearchTool.outputSchema.safeParse({
      articles: [
        {
          pmid: '12345678',
          title: 'Test',
          abstract: '',
          authors: [],
          journal: 'Test',
          publicationDate: '2026',
          doi: '10.1234/test',
          url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
        },
      ],
      totalCount: 1,
      query: 'test',
    });
    expect(result.success).toBe(true);
  });
});
