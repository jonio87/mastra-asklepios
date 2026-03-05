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

const OrphanetApiSearchSchema = z.object({
  results: z
    .array(
      z.object({
        // biome-ignore lint/style/useNamingConvention: Orphanet API field
        ORPHAcode: z.number(),
        'Preferred term': z.string().optional(),
        // biome-ignore lint/style/useNamingConvention: Orphanet API field
        Definition: z.string().optional(),
      }),
    )
    .optional(),
});

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
    if (!(data.success && data.data.results)) {
      logger.warn('Orphanet search returned no valid results', { query });
      return { diseases: [], query };
    }

    const results = data.data.results.slice(0, maxResults);

    const diseases: OrphanetDisease[] = results.map((r) => ({
      orphaNumber: r.ORPHAcode,
      name: r['Preferred term'] ?? 'Unknown',
      definition: r.Definition ?? 'No definition available',
      genes: [],
      synonyms: [],
      url: `https://www.orpha.net/en/disease/detail/${r.ORPHAcode}`,
    }));

    logger.info('Orphanet search complete', { query, resultCount: diseases.length });
    return { diseases, query };
  },
});

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
  return {
    orphaNumber: data.ORPHAcode,
    name: data['Preferred term'] ?? 'Unknown',
    definition: data.Definition ?? 'No definition available',
    ageOfOnset: data.AverageAgeOfOnset?.join(', '),
    inheritanceMode: data.TypeOfInheritance?.join(', '),
    genes: [],
    synonyms: data.Synonyms ?? [],
    url: `https://www.orpha.net/en/disease/detail/${data.ORPHAcode}`,
  };
}
