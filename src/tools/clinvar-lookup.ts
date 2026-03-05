import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { logger } from '../utils/logger.js';
import { NCBI_BASE_URL, ncbiFetch } from '../utils/ncbi-rate-limiter.js';

const ClinVarVariantSchema = z.object({
  accession: z.string().describe('ClinVar accession (e.g., RCV000123456)'),
  title: z.string().describe('Variant description'),
  clinicalSignificance: z
    .string()
    .describe('Clinical significance (Pathogenic, Benign, Uncertain significance, etc.)'),
  reviewStatus: z
    .string()
    .describe('Review status (e.g., criteria provided, reviewed by expert panel)'),
  gene: z.string().describe('Gene symbol'),
  condition: z.string().describe('Associated condition/phenotype'),
  lastEvaluated: z.string().optional().describe('Date of last clinical evaluation'),
  hgvsNotation: z.string().optional().describe('HGVS notation for the variant'),
  url: z.string().describe('Link to ClinVar record'),
});

export type ClinVarVariant = z.infer<typeof ClinVarVariantSchema>;

/** Build a ClinVar search query from structured inputs. */
export function buildClinVarQuery(params: {
  query?: string;
  gene?: string;
  variant?: string;
}): string {
  const parts: string[] = [];

  if (params.gene) parts.push(`${params.gene}[GENE]`);
  if (params.variant) parts.push(`${params.variant}`);
  if (params.query && !params.gene && !params.variant) parts.push(params.query);

  // If we have gene + query but no variant, use query as free text alongside gene tag
  if (params.query && params.gene && !params.variant) {
    parts.push(params.query);
  }

  return parts.join(' AND ') || 'clinvar[sb]';
}

export const clinvarLookupTool = createTool({
  id: 'clinvar-lookup',
  description:
    'Look up genetic variant pathogenicity in ClinVar. Search by gene symbol, HGVS variant notation, or free text. Returns clinical significance, review status, and associated conditions. Essential for variant interpretation in rare disease diagnosis.',
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe('Free text search query (e.g., "Ehlers-Danlos", "arterial dissection")'),
    gene: z
      .string()
      .optional()
      .describe('Gene symbol for field-specific search (e.g., "COL3A1", "FBN1")'),
    variant: z
      .string()
      .optional()
      .describe('HGVS notation for variant-specific search (e.g., "c.1854+1G>A")'),
    maxResults: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of results to return (default: 10)'),
  }),
  outputSchema: z.object({
    variants: z.array(ClinVarVariantSchema).describe('List of matching ClinVar variants'),
    totalCount: z.number().describe('Total number of matching variants in ClinVar'),
    query: z.string().describe('The search query that was executed'),
  }),
  execute: async (inputData) => {
    const { query, gene, variant, maxResults = 10 } = inputData;
    const searchQuery = buildClinVarQuery({
      ...(query !== undefined ? { query } : {}),
      ...(gene !== undefined ? { gene } : {}),
      ...(variant !== undefined ? { variant } : {}),
    });

    logger.info('Searching ClinVar', { searchQuery, gene, variant, maxResults });

    const searchUrl = `${NCBI_BASE_URL}/esearch.fcgi?db=clinvar&term=${encodeURIComponent(searchQuery)}&retmax=${maxResults}&retmode=json`;

    const searchResponse = await ncbiFetch(searchUrl);
    if (!searchResponse.ok) {
      logger.error('ClinVar search failed', { status: searchResponse.status });
      return { variants: [], totalCount: 0, query: searchQuery };
    }

    const searchData = (await searchResponse.json()) as {
      esearchresult?: { idlist?: string[]; count?: string };
    };
    const ids = searchData.esearchresult?.idlist ?? [];
    const totalCount = Number.parseInt(searchData.esearchresult?.count ?? '0', 10);

    if (ids.length === 0) {
      logger.info('No ClinVar results found', { searchQuery });
      return { variants: [], totalCount: 0, query: searchQuery };
    }

    const summaryUrl = `${NCBI_BASE_URL}/esummary.fcgi?db=clinvar&id=${ids.join(',')}&retmode=json`;
    const summaryResponse = await ncbiFetch(summaryUrl);

    if (!summaryResponse.ok) {
      logger.error('ClinVar summary fetch failed', { status: summaryResponse.status });
      return { variants: [], totalCount, query: searchQuery };
    }

    const summaryData = (await summaryResponse.json()) as {
      result?: Record<string, unknown>;
    };
    const result = summaryData.result ?? {};

    const variants: ClinVarVariant[] = ids.reduce<ClinVarVariant[]>((acc, id) => {
      const raw = result[id];
      if (!raw || typeof raw !== 'object') return acc;

      const record = raw as Record<string, unknown>;

      const clinicalSignificance = extractClinicalSignificance(record);
      const reviewStatus = extractReviewStatus(record);
      const geneName = extractGene(record);
      const condition = extractCondition(record);

      acc.push({
        accession: (record['accession'] as string) ?? id,
        title: (record['title'] as string) ?? 'Unknown variant',
        clinicalSignificance,
        reviewStatus,
        gene: geneName,
        condition,
        lastEvaluated: (record['last_evaluated'] as string) ?? undefined,
        hgvsNotation: extractHgvs(record),
        url: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${id}/`,
      });
      return acc;
    }, []);

    logger.info('ClinVar search complete', {
      searchQuery,
      resultCount: variants.length,
      totalCount,
    });
    return { variants, totalCount, query: searchQuery };
  },
});

function extractClinicalSignificance(record: Record<string, unknown>): string {
  // ClinVar esummary uses various field names depending on record type
  const sig = record['clinical_significance'] ?? record['clinicalsignificance'];
  if (typeof sig === 'string') return sig;

  const desc = (sig as Record<string, unknown> | undefined)?.['description'];
  if (typeof desc === 'string') return desc;

  return 'Not provided';
}

function extractReviewStatus(record: Record<string, unknown>): string {
  const status = record['review_status'] ?? record['reviewstatus'];
  if (typeof status === 'string') return status;
  return 'Not provided';
}

function extractGene(record: Record<string, unknown>): string {
  // genes field can be an array of objects or a nested structure
  const genes = record['genes'] as unknown[] | undefined;
  if (Array.isArray(genes) && genes.length > 0) {
    const first = genes[0] as Record<string, unknown> | undefined;
    const symbol = first?.['symbol'] ?? first?.['gene_symbol'];
    if (typeof symbol === 'string') return symbol;
  }
  return (record['gene_symbol'] as string) ?? 'Unknown';
}

function extractCondition(record: Record<string, unknown>): string {
  const traits = record['trait_set'] ?? record['trait_name'];
  if (typeof traits === 'string') return traits;
  if (Array.isArray(traits) && traits.length > 0) {
    const first = traits[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'object' && first !== null) {
      const name = (first as Record<string, unknown>)['trait_name'];
      if (typeof name === 'string') return name;
    }
  }
  return 'Not specified';
}

function extractHgvs(record: Record<string, unknown>): string | undefined {
  const variation = record['variation_set'] ?? record['variation'];
  if (Array.isArray(variation) && variation.length > 0) {
    const first = variation[0] as Record<string, unknown> | undefined;
    const hgvs = first?.['cdna_change'] ?? first?.['hgvs'];
    if (typeof hgvs === 'string') return hgvs;
  }
  const title = record['title'];
  if (typeof title === 'string' && title.includes('c.')) return undefined; // title contains variant info but not clean HGVS
  return undefined;
}
