import {
  extractAllIds,
  extractDois,
  extractGeneSymbols,
  extractNctIds,
  extractOmimIds,
  extractOrphaCodes,
  extractPmids,
} from './id-extractor.js';

describe('extractPmids', () => {
  it('extracts PMID with colon separator', () => {
    const result = extractPmids('See PMID: 39465424 for details');
    expect(result).toEqual([{ id: '39465424', type: 'pmid' }]);
  });

  it('extracts PMID with space separator', () => {
    const result = extractPmids('Ref: PMID 40594218');
    expect(result).toEqual([{ id: '40594218', type: 'pmid' }]);
  });

  it('extracts PMID from PubMed URL', () => {
    const result = extractPmids('https://pubmed.ncbi.nlm.nih.gov/41609902/');
    expect(result).toEqual([{ id: '41609902', type: 'pmid' }]);
  });

  it('extracts multiple PMIDs and deduplicates', () => {
    const result = extractPmids('PMID: 39465424 and PMID:39465424 and PMID: 40594218');
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toContain('39465424');
    expect(result.map((r) => r.id)).toContain('40594218');
  });

  it('returns empty array when no PMIDs found', () => {
    expect(extractPmids('No references here')).toEqual([]);
  });
});

describe('extractNctIds', () => {
  it('extracts NCT ID from text', () => {
    const result = extractNctIds('Clinical trial NCT05537935 is recruiting');
    expect(result).toEqual([{ id: 'NCT05537935', type: 'nct' }]);
  });

  it('normalizes to uppercase', () => {
    const result = extractNctIds('nct04762758');
    expect(result).toEqual([{ id: 'NCT04762758', type: 'nct' }]);
  });

  it('extracts multiple NCT IDs', () => {
    const result = extractNctIds('NCT05537935 and NCT04762758 and NCT04814381');
    expect(result).toHaveLength(3);
  });

  it('deduplicates repeated NCT IDs', () => {
    const result = extractNctIds('NCT05537935 mentioned twice NCT05537935');
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no NCT IDs found', () => {
    expect(extractNctIds('No trials mentioned')).toEqual([]);
  });
});

describe('extractOrphaCodes', () => {
  it('extracts ORPHA code with colon', () => {
    const result = extractOrphaCodes('Disease ORPHA:12345');
    expect(result).toEqual([{ id: 'ORPHA:12345', type: 'orpha' }]);
  });

  it('extracts ORPHANET code', () => {
    const result = extractOrphaCodes('ORPHANET: 67890');
    expect(result).toEqual([{ id: 'ORPHA:67890', type: 'orpha' }]);
  });

  it('returns empty array when no ORPHA codes found', () => {
    expect(extractOrphaCodes('No orphanet references')).toEqual([]);
  });
});

describe('extractOmimIds', () => {
  it('extracts OMIM ID with space', () => {
    const result = extractOmimIds('OMIM 116790');
    expect(result).toEqual([{ id: '116790', type: 'omim' }]);
  });

  it('extracts OMIM ID with colon', () => {
    const result = extractOmimIds('OMIM:601769');
    expect(result).toEqual([{ id: '601769', type: 'omim' }]);
  });

  it('extracts MIM# format', () => {
    const result = extractOmimIds('MIM# 116790');
    expect(result).toEqual([{ id: '116790', type: 'omim' }]);
  });

  it('deduplicates repeated OMIM IDs', () => {
    const result = extractOmimIds('OMIM 116790 and MIM#116790');
    expect(result).toHaveLength(1);
  });

  it('returns empty for no OMIM IDs', () => {
    expect(extractOmimIds('No OMIM references')).toEqual([]);
  });
});

describe('extractDois', () => {
  it('extracts DOI from text', () => {
    const result = extractDois('doi: 10.1038/s41467-025-12345');
    expect(result).toEqual([{ id: '10.1038/s41467-025-12345', type: 'doi' }]);
  });

  it('extracts DOI from URL', () => {
    const result = extractDois('https://doi.org/10.1016/j.jaci.2024.05.001');
    expect(result).toEqual([{ id: '10.1016/j.jaci.2024.05.001', type: 'doi' }]);
  });

  it('returns empty for no DOIs', () => {
    expect(extractDois('No DOIs here')).toEqual([]);
  });
});

describe('extractGeneSymbols', () => {
  it('extracts known gene symbols', () => {
    const result = extractGeneSymbols('The COMT gene is expressed at C1 spinal cord');
    expect(result).toEqual([{ id: 'COMT', type: 'gene' }]);
  });

  it('extracts multiple gene symbols', () => {
    const result = extractGeneSymbols('MTHFR and CBS and VDR variants');
    expect(result).toHaveLength(3);
    const ids = result.map((r) => r.id);
    expect(ids).toContain('MTHFR');
    expect(ids).toContain('CBS');
    expect(ids).toContain('VDR');
  });

  it('does not extract unknown gene-like tokens', () => {
    const result = extractGeneSymbols('The ABC protein and XYZ kinase');
    expect(result).toEqual([]);
  });

  it('matches case-sensitively (uppercase only)', () => {
    const result = extractGeneSymbols('The comt gene lowercase');
    expect(result).toEqual([]);
  });

  it('extracts patient-specific genes', () => {
    const result = extractGeneSymbols('ACE expression in testis 112.3 TPM');
    expect(result).toEqual([{ id: 'ACE', type: 'gene' }]);
  });
});

describe('extractAllIds', () => {
  it('combines all extractors', () => {
    const text = `
      Study PMID: 39465424 evaluated COMT gene expression.
      Clinical trial NCT05537935 is recruiting.
      Disease ORPHA:12345 maps to OMIM 116790.
      doi: 10.1038/s41467-025-99999
    `;
    const result = extractAllIds(text);
    const types = result.map((r) => r.type);
    expect(types).toContain('pmid');
    expect(types).toContain('gene');
    expect(types).toContain('nct');
    expect(types).toContain('orpha');
    expect(types).toContain('omim');
    expect(types).toContain('doi');
    expect(result.length).toBe(6);
  });

  it('returns empty array for text with no identifiers', () => {
    expect(extractAllIds('Just a plain text sentence.')).toEqual([]);
  });
});
