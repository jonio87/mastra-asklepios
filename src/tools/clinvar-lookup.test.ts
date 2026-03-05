import { describe, expect, it } from '@jest/globals';

import { buildClinVarQuery, clinvarLookupTool } from './clinvar-lookup.js';

describe('ClinVar Lookup', () => {
  describe('buildClinVarQuery', () => {
    it('builds query from gene symbol', () => {
      expect(buildClinVarQuery({ gene: 'COL3A1' })).toBe('COL3A1[GENE]');
    });

    it('builds query from variant notation', () => {
      expect(buildClinVarQuery({ variant: 'c.1854+1G>A' })).toBe('c.1854+1G>A');
    });

    it('builds query from gene + variant', () => {
      expect(buildClinVarQuery({ gene: 'COL3A1', variant: 'c.1854+1G>A' })).toBe(
        'COL3A1[GENE] AND c.1854+1G>A',
      );
    });

    it('uses free text query when no gene or variant', () => {
      expect(buildClinVarQuery({ query: 'Ehlers-Danlos' })).toBe('Ehlers-Danlos');
    });

    it('adds free text alongside gene tag', () => {
      expect(buildClinVarQuery({ gene: 'COL3A1', query: 'pathogenic' })).toBe(
        'COL3A1[GENE] AND pathogenic',
      );
    });

    it('returns fallback for empty params', () => {
      expect(buildClinVarQuery({})).toBe('clinvar[sb]');
    });

    it('ignores query when gene is present without variant', () => {
      const result = buildClinVarQuery({ gene: 'FBN1', query: 'Marfan syndrome' });
      expect(result).toContain('FBN1[GENE]');
      expect(result).toContain('Marfan syndrome');
    });
  });

  describe('clinvarLookupTool', () => {
    it('has correct tool configuration', () => {
      expect(clinvarLookupTool.id).toBe('clinvar-lookup');
      expect(clinvarLookupTool.description).toContain('ClinVar');
      expect(clinvarLookupTool.inputSchema).toBeDefined();
      expect(clinvarLookupTool.outputSchema).toBeDefined();
      expect(clinvarLookupTool.execute).toBeDefined();
    });

    it('validates input with gene only', () => {
      const result = clinvarLookupTool.inputSchema.safeParse({
        gene: 'COL3A1',
      });
      expect(result.success).toBe(true);
    });

    it('validates input with query only', () => {
      const result = clinvarLookupTool.inputSchema.safeParse({
        query: 'Ehlers-Danlos',
      });
      expect(result.success).toBe(true);
    });

    it('validates input with gene + variant + maxResults', () => {
      const result = clinvarLookupTool.inputSchema.safeParse({
        gene: 'COL3A1',
        variant: 'c.1854+1G>A',
        maxResults: 5,
      });
      expect(result.success).toBe(true);
    });

    it('rejects maxResults above 50', () => {
      const result = clinvarLookupTool.inputSchema.safeParse({
        query: 'test',
        maxResults: 100,
      });
      expect(result.success).toBe(false);
    });

    it('rejects maxResults below 1', () => {
      const result = clinvarLookupTool.inputSchema.safeParse({
        query: 'test',
        maxResults: 0,
      });
      expect(result.success).toBe(false);
    });

    it('accepts empty input (all fields optional)', () => {
      const result = clinvarLookupTool.inputSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('validates output schema structure', () => {
      const result = clinvarLookupTool.outputSchema.safeParse({
        variants: [
          {
            accession: 'RCV000012345',
            title: 'COL3A1 c.1854+1G>A',
            clinicalSignificance: 'Pathogenic',
            reviewStatus: 'criteria provided, single submitter',
            gene: 'COL3A1',
            condition: 'Ehlers-Danlos syndrome, vascular type',
            lastEvaluated: '2024-01-15',
            hgvsNotation: 'c.1854+1G>A',
            url: 'https://www.ncbi.nlm.nih.gov/clinvar/variation/12345/',
          },
        ],
        totalCount: 1,
        query: 'COL3A1[GENE] AND c.1854+1G>A',
      });
      expect(result.success).toBe(true);
    });
  });
});
