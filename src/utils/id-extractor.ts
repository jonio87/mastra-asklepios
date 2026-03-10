/**
 * External ID Extraction Utility — extracts structured identifiers
 * (PMIDs, NCT IDs, ORPHA codes, OMIM IDs, gene symbols, DOIs)
 * from unstructured research text.
 *
 * Used by auto-capture hooks in research tools to create structured
 * research_findings records with queryable external IDs.
 */

import type { ExternalIdType } from '../schemas/research-record.js';

export interface ExtractedId {
  id: string;
  type: ExternalIdType;
}

/** Extract PubMed IDs — patterns: "PMID: 12345678", "PMID12345678", "pubmed/12345678" */
export function extractPmids(text: string): ExtractedId[] {
  const seen = new Set<string>();
  const results: ExtractedId[] = [];

  // PMID: 12345678 or PMID 12345678 or PMID:12345678
  const pmidPattern = /PMID[:\s]*(\d{6,9})/gi;
  for (const match of text.matchAll(pmidPattern)) {
    const id = match[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      results.push({ id, type: 'pmid' });
    }
  }

  // pubmed/12345678 or pubmed.ncbi.nlm.nih.gov/12345678
  const urlPattern = /pubmed[./](?:ncbi\.nlm\.nih\.gov\/)?(\d{6,9})/gi;
  for (const match of text.matchAll(urlPattern)) {
    const id = match[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      results.push({ id, type: 'pmid' });
    }
  }

  return results;
}

/** Extract ClinicalTrials.gov IDs — pattern: "NCT" followed by 8 digits */
export function extractNctIds(text: string): ExtractedId[] {
  const seen = new Set<string>();
  const results: ExtractedId[] = [];

  const pattern = /NCT\d{8}/gi;
  for (const match of text.matchAll(pattern)) {
    const id = match[0]?.toUpperCase();
    if (id && !seen.has(id)) {
      seen.add(id);
      results.push({ id, type: 'nct' });
    }
  }

  return results;
}

/** Extract Orphanet codes — patterns: "ORPHA:12345", "ORPHANET:12345" */
export function extractOrphaCodes(text: string): ExtractedId[] {
  const seen = new Set<string>();
  const results: ExtractedId[] = [];

  const pattern = /ORPHA(?:NET)?[:\s]\s*(\d{1,7})/gi;
  for (const match of text.matchAll(pattern)) {
    const code = match[1];
    if (code && !seen.has(code)) {
      seen.add(code);
      results.push({ id: `ORPHA:${code}`, type: 'orpha' });
    }
  }

  return results;
}

/** Extract OMIM IDs — patterns: "OMIM 123456", "OMIM:123456", "MIM# 123456" */
export function extractOmimIds(text: string): ExtractedId[] {
  const seen = new Set<string>();
  const results: ExtractedId[] = [];

  const pattern = /(?:OMIM|MIM#?)[:\s]*(\d{6})/gi;
  for (const match of text.matchAll(pattern)) {
    const id = match[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      results.push({ id, type: 'omim' });
    }
  }

  return results;
}

/** Extract DOIs — pattern: "10.XXXX/..." */
export function extractDois(text: string): ExtractedId[] {
  const seen = new Set<string>();
  const results: ExtractedId[] = [];

  const pattern = /\b(10\.\d{4,9}\/[^\s,;)]+)/g;
  for (const match of text.matchAll(pattern)) {
    const doi = match[1];
    if (doi && !seen.has(doi)) {
      seen.add(doi);
      results.push({ id: doi, type: 'doi' });
    }
  }

  return results;
}

/**
 * Known human gene symbols — conservative subset covering genes
 * commonly encountered in rare disease research.
 * Upper-case only, minimum 2 characters, excludes common English words.
 */
const KNOWN_GENES = new Set([
  // Asklepios patient-specific genes
  'COMT',
  'MTHFR',
  'CBS',
  'VDR',
  'ACE',
  // Common rare disease genes
  'BRCA1',
  'BRCA2',
  'TP53',
  'EGFR',
  'KRAS',
  'BRAF',
  'PIK3CA',
  'HER2',
  'ALK',
  'ROS1',
  'MET',
  'RET',
  'NTRK1',
  'NTRK2',
  'NTRK3',
  'CFTR',
  'HTT',
  'FMR1',
  'DMD',
  'SMN1',
  'SMN2',
  'FGFR1',
  'FGFR2',
  'FGFR3',
  'COL1A1',
  'COL1A2',
  'JAK2',
  'MPL',
  'CALR',
  'BCR',
  'ABL1',
  'GBA',
  'HEXA',
  'HEXB',
  'ASPA',
  'GALC',
  'CYP2D6',
  'CYP2C19',
  'CYP3A4',
  'CYP1A2',
  'UGT1A1',
  'APOE',
  'APP',
  'PSEN1',
  'PSEN2',
  'MAPT',
  'GRN',
  'LMNA',
  'TTN',
  'MYH7',
  'MYBPC3',
  'SCN5A',
  'PAH',
  'GALT',
  'ACADM',
  'MCCC2',
  'SERPINA1',
  'HFE',
  'ATP7B',
  'RB1',
  'APC',
  'MLH1',
  'MSH2',
  'MSH6',
  'PMS2',
  'NF1',
  'NF2',
  'TSC1',
  'TSC2',
  'VHL',
  'WT1',
  'MEN1',
  'OPRD1',
  'OPRM1',
  'OPRK1',
  'TLR4',
  'TRPM3',
  'PR3',
]);

/** Extract gene symbols from text — matches known gene symbols as whole words */
export function extractGeneSymbols(text: string): ExtractedId[] {
  const seen = new Set<string>();
  const results: ExtractedId[] = [];

  // Match word boundaries around uppercase gene-like tokens (2-10 chars, letters+digits)
  const pattern = /\b([A-Z][A-Z0-9]{1,9})\b/g;
  for (const match of text.matchAll(pattern)) {
    const symbol = match[1];
    if (symbol && KNOWN_GENES.has(symbol) && !seen.has(symbol)) {
      seen.add(symbol);
      results.push({ id: symbol, type: 'gene' });
    }
  }

  return results;
}

/** Extract all structured IDs from text — combines all extractors */
export function extractAllIds(text: string): ExtractedId[] {
  return [
    ...extractPmids(text),
    ...extractNctIds(text),
    ...extractOrphaCodes(text),
    ...extractOmimIds(text),
    ...extractDois(text),
    ...extractGeneSymbols(text),
  ];
}
