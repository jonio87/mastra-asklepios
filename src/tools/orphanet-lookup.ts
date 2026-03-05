import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { logger } from '../utils/logger.js';

const OrphanetDiseaseSchema = z.object({
  orphaNumber: z.number().describe('Orphanet disease number (ORPHAcode)'),
  name: z.string().describe('Disease name'),
  definition: z.string().describe('Disease definition / summary'),
  prevalence: z.string().optional().describe('Estimated prevalence'),
  inheritanceMode: z.string().optional().describe('Mode of inheritance'),
  ageOfOnset: z.string().optional().describe('Typical age of onset'),
  genes: z
    .array(
      z.object({
        symbol: z.string().describe('Gene symbol (e.g., FBN1)'),
        name: z.string().describe('Full gene name'),
      }),
    )
    .describe('Associated genes'),
  synonyms: z.array(z.string()).describe('Disease name synonyms'),
  url: z.string().describe('Link to Orphanet disease page'),
});

export type OrphanetDisease = z.infer<typeof OrphanetDiseaseSchema>;

const ORPHANET_API_BASE = 'https://api.orphacode.org';

const OrphanetApiSearchItemSchema = z.object({
  // biome-ignore lint/style/useNamingConvention: Orphanet API field
  ORPHAcode: z.number(),
  'Preferred term': z.string().optional(),
  // biome-ignore lint/style/useNamingConvention: Orphanet API field
  Definition: z.string().optional(),
});

/** Orphanet search API may return a plain array or `{ results: [...] }`. */
const OrphanetApiSearchSchema = z.union([
  z.array(OrphanetApiSearchItemSchema),
  z.object({ results: z.array(OrphanetApiSearchItemSchema).optional() }),
]);

const OrphanetApiDetailSchema = z.object({
  // biome-ignore lint/style/useNamingConvention: Orphanet API field
  ORPHAcode: z.number(),
  'Preferred term': z.string().optional(),
  // biome-ignore lint/style/useNamingConvention: Orphanet API field
  Definition: z.string().optional(),
  // biome-ignore lint/style/useNamingConvention: Orphanet API field
  AverageAgeOfOnset: z.array(z.string()).optional(),
  // biome-ignore lint/style/useNamingConvention: Orphanet API field
  TypeOfInheritance: z.array(z.string()).optional(),
  // biome-ignore lint/style/useNamingConvention: Orphanet API field
  Synonyms: z.array(z.string()).optional(),
});

const OrphanetGeneItemSchema = z.object({
  // biome-ignore lint/style/useNamingConvention: Orphanet API field
  Symbol: z.string().optional(),
  // biome-ignore lint/style/useNamingConvention: Orphanet API field
  Name: z.string().optional(),
  'Gene symbol': z.string().optional(),
  'Gene name': z.string().optional(),
});

const OrphanetApiGeneSchema = z
  .object({
    data: z.array(OrphanetGeneItemSchema).optional(),
    // Alternative shapes — Orphanet gene endpoint may return top-level array or nested
  })
  .passthrough();

export const orphanetLookupTool = createTool({
  id: 'orphanet-lookup',
  description:
    'Look up rare diseases in the Orphanet database. Use this to find information about rare diseases including associated genes, inheritance patterns, prevalence, and clinical definitions. Search by disease name or ORPHAcode.',
  inputSchema: z.object({
    query: z.string().describe('Disease name or keywords to search for'),
    orphaCode: z
      .number()
      .optional()
      .describe('Specific ORPHAcode to look up directly (bypasses search)'),
    maxResults: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .describe('Maximum number of search results (default: 5)'),
  }),
  outputSchema: z.object({
    diseases: z.array(OrphanetDiseaseSchema).describe('List of matching rare diseases'),
    query: z.string().describe('The query that was executed'),
  }),
  execute: async (inputData) => {
    const { query, orphaCode, maxResults = 5 } = inputData;

    logger.info('Looking up Orphanet', { query, orphaCode });

    if (orphaCode !== undefined) {
      const disease = await fetchOrphanetDisease(orphaCode);
      return {
        diseases: disease ? [disease] : [],
        query: `ORPHAcode:${orphaCode}`,
      };
    }

    const searchUrl = `${ORPHANET_API_BASE}/EN/ClinicalEntity/ApproximateName/${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: { accept: 'application/json', apiKey: 'GUEST' },
    });

    if (!response.ok) {
      logger.error('Orphanet search failed', { status: response.status });
      return { diseases: [], query };
    }

    const data = OrphanetApiSearchSchema.safeParse(await response.json());
    if (!data.success) {
      logger.warn('Orphanet search returned no valid results', { query });
      return { diseases: [], query };
    }

    // API may return a plain array or { results: [...] }
    const items = Array.isArray(data.data) ? data.data : (data.data.results ?? []);
    if (items.length === 0) {
      logger.warn('Orphanet search returned empty results', { query });
      return { diseases: [], query };
    }

    const results = items.slice(0, maxResults);

    const diseases: OrphanetDisease[] = await Promise.all(
      results.map(async (r) => {
        const genes = await fetchGenes(r.ORPHAcode);
        return {
          orphaNumber: r.ORPHAcode,
          name: r['Preferred term'] ?? 'Unknown',
          definition: r.Definition ?? 'No definition available',
          genes,
          synonyms: [],
          url: `https://www.orpha.net/en/disease/detail/${r.ORPHAcode}`,
        };
      }),
    );

    logger.info('Orphanet search complete', { query, resultCount: diseases.length });
    return { diseases, query };
  },
});

/** Extract gene symbol/name from a single Orphanet gene record. */
function extractGeneFields(item: unknown): { symbol: string; name: string } | undefined {
  if (typeof item !== 'object' || item === null) return undefined;
  const record = item as Record<string, unknown>;
  const symbol =
    (typeof record['Symbol'] === 'string' ? record['Symbol'] : undefined) ??
    (typeof record['Gene symbol'] === 'string' ? record['Gene symbol'] : undefined);
  const name =
    (typeof record['Name'] === 'string' ? record['Name'] : undefined) ??
    (typeof record['Gene name'] === 'string' ? record['Gene name'] : undefined);
  return symbol ? { symbol, name: name ?? symbol } : undefined;
}

/** Normalize the various Orphanet gene API response shapes into an array. */
function normalizeGeneItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const parsed = OrphanetApiGeneSchema.safeParse(raw);
  return parsed.success ? (parsed.data.data ?? []) : [];
}

async function fetchGenes(orphaCode: number): Promise<Array<{ symbol: string; name: string }>> {
  const url = `${ORPHANET_API_BASE}/EN/ClinicalEntity/orphacode/${orphaCode}/Gene`;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', apiKey: 'GUEST' },
    });

    if (!response.ok) {
      logger.debug('Orphanet gene fetch returned non-OK', {
        orphaCode,
        status: response.status,
      });
      return [];
    }

    const raw: unknown = await response.json();
    const items = normalizeGeneItems(raw);
    const genes = items.map(extractGeneFields).filter(Boolean) as Array<{
      symbol: string;
      name: string;
    }>;

    logger.debug('Orphanet gene fetch complete', {
      orphaCode,
      geneCount: genes.length,
    });
    return genes;
  } catch {
    logger.debug('Orphanet gene fetch error', { orphaCode });
    return [];
  }
}

async function fetchOrphanetDisease(orphaCode: number): Promise<OrphanetDisease | undefined> {
  const url = `${ORPHANET_API_BASE}/EN/ClinicalEntity/orphacode/${orphaCode}`;
  const response = await fetch(url, {
    headers: { accept: 'application/json', apiKey: 'GUEST' },
  });

  if (!response.ok) {
    logger.error('Orphanet disease fetch failed', { orphaCode, status: response.status });
    return undefined;
  }

  const parsed = OrphanetApiDetailSchema.safeParse(await response.json());
  if (!parsed.success) {
    logger.warn('Orphanet disease parse failed', { orphaCode });
    return undefined;
  }

  const data = parsed.data;
  const genes = await fetchGenes(data.ORPHAcode);

  return {
    orphaNumber: data.ORPHAcode,
    name: data['Preferred term'] ?? 'Unknown',
    definition: data.Definition ?? 'No definition available',
    ageOfOnset: data.AverageAgeOfOnset?.join(', '),
    inheritanceMode: data.TypeOfInheritance?.join(', '),
    genes,
    synonyms: data.Synonyms ?? [],
    url: `https://www.orpha.net/en/disease/detail/${data.ORPHAcode}`,
  };
}
