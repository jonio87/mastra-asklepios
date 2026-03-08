import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { logger } from '../utils/logger.js';

const OPENFDA_BASE = 'https://api.fda.gov';

const AdverseEventSchema = z.object({
  term: z.string().describe('Adverse reaction term (MedDRA preferred term)'),
  count: z.number().describe('Number of adverse event reports containing this term'),
});

const DrugLabelSchema = z.object({
  brandName: z.string().describe('Drug brand name'),
  genericName: z.string().describe('Drug generic name'),
  warnings: z.string().optional().describe('Drug warnings text'),
  adverseReactions: z.string().optional().describe('Adverse reactions section from label'),
  indications: z.string().optional().describe('Indications and usage'),
  dosage: z.string().optional().describe('Dosage and administration'),
  url: z.string().optional().describe('Link to drug label'),
});

export type AdverseEvent = z.infer<typeof AdverseEventSchema>;
export type DrugLabel = z.infer<typeof DrugLabelSchema>;

/** Build OpenFDA API URL with optional API key. */
function buildUrl(endpoint: string, params: Record<string, string>): string {
  const apiKey = process.env['OPENFDA_API_KEY'];
  const searchParams = new URLSearchParams(params);
  if (apiKey) searchParams.set('api_key', apiKey);
  return `${OPENFDA_BASE}${endpoint}?${searchParams.toString()}`;
}

// --- API response types ---

interface OpenFdaEventResult {
  term?: string;
  count?: number;
}

interface OpenFdaEventResponse {
  results?: OpenFdaEventResult[];
  error?: { code?: string; message?: string };
}

interface OpenFdaLabelResult {
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    spl_set_id?: string[];
  };
  warnings?: string[];
  adverse_reactions?: string[];
  indications_and_usage?: string[];
  dosage_and_administration?: string[];
}

interface OpenFdaLabelResponse {
  results?: OpenFdaLabelResult[];
  error?: { code?: string; message?: string };
}

/** Truncate long text fields to keep output manageable. */
function truncateText(text: string | undefined, maxLength = 2000): string | undefined {
  if (!text) return undefined;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}… [truncated]`;
}

export const openfdaLookupTool = createTool({
  id: 'openfda-lookup',
  description:
    'Search the FDA adverse event reporting system (FAERS) and drug labeling database. Count adverse reactions for a drug, check specific drug-reaction associations, or retrieve drug label information (warnings, indications, dosage). No API key required (optional key increases rate limits).',
  inputSchema: z.object({
    drugName: z
      .string()
      .describe('Drug name to search (brand or generic, e.g., "bupropion", "naltrexone")'),
    mode: z
      .enum(['adverse-events', 'label'])
      .optional()
      .describe(
        'Search mode: adverse-events (FAERS reports) or label (drug labeling). Default: adverse-events',
      ),
    reactionTerm: z
      .string()
      .optional()
      .describe(
        'Specific adverse reaction to check (MedDRA term, e.g., "leukopenia", "neutropenia")',
      ),
    topN: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe('Number of top adverse reactions to return when counting (default: 20)'),
  }),
  outputSchema: z.object({
    drugName: z.string().describe('Drug name searched'),
    adverseEvents: z
      .array(AdverseEventSchema)
      .optional()
      .describe('Top adverse events by report count'),
    specificReactionCount: z
      .number()
      .optional()
      .describe('Report count for the specific reaction term queried'),
    totalReports: z.number().optional().describe('Total adverse event reports for this drug'),
    labels: z.array(DrugLabelSchema).optional().describe('Drug label information'),
    query: z.string().describe('The API query that was executed'),
  }),
  execute: async (inputData) => {
    const { drugName, mode = 'adverse-events', reactionTerm, topN = 20 } = inputData;

    if (mode === 'label') {
      return searchDrugLabels(drugName);
    }

    return searchAdverseEvents(drugName, reactionTerm, topN);
  },
});

async function searchAdverseEvents(
  drugName: string,
  reactionTerm: string | undefined,
  topN: number,
): Promise<{
  drugName: string;
  adverseEvents?: AdverseEvent[];
  specificReactionCount?: number;
  totalReports?: number;
  query: string;
}> {
  logger.info('Searching OpenFDA adverse events', { drugName, reactionTerm });

  // First, get total reports count
  const countQuery = `patient.drug.openfda.generic_name:"${drugName}"`;
  const countUrl = buildUrl('/drug/event.json', {
    search: countQuery,
    limit: '1',
  });

  let totalReports: number | undefined;
  try {
    const countResponse = await fetch(countUrl);
    if (countResponse.ok) {
      const countData = (await countResponse.json()) as { meta?: { results?: { total?: number } } };
      totalReports = countData.meta?.results?.total;
    }
  } catch {
    // Non-critical — continue without total count
  }

  // Get top adverse reactions by count
  const topUrl = buildUrl('/drug/event.json', {
    search: countQuery,
    count: 'patient.reaction.reactionmeddrapt.exact',
    limit: String(topN),
  });

  let adverseEvents: AdverseEvent[] | undefined;
  try {
    const topResponse = await fetch(topUrl);
    if (topResponse.ok) {
      const topData = (await topResponse.json()) as OpenFdaEventResponse;
      if (topData.results) {
        adverseEvents = topData.results
          .filter(
            (r): r is { term: string; count: number } =>
              typeof r.term === 'string' && typeof r.count === 'number',
          )
          .map((r) => ({ term: r.term, count: r.count }));
      }
    }
  } catch (error) {
    logger.warn('OpenFDA top adverse events query failed', { error: String(error) });
  }

  // If specific reaction term requested, check its count
  let specificReactionCount: number | undefined;
  if (reactionTerm) {
    const specificQuery = `${countQuery}+AND+patient.reaction.reactionmeddrapt:"${reactionTerm}"`;
    const specificUrl = buildUrl('/drug/event.json', {
      search: specificQuery,
      limit: '1',
    });

    try {
      const specificResponse = await fetch(specificUrl);
      if (specificResponse.ok) {
        const specificData = (await specificResponse.json()) as {
          meta?: { results?: { total?: number } };
        };
        specificReactionCount = specificData.meta?.results?.total;
      } else {
        specificReactionCount = 0;
      }
    } catch {
      specificReactionCount = 0;
    }
  }

  const query = reactionTerm
    ? `${drugName} + ${reactionTerm} (adverse events)`
    : `${drugName} (adverse events)`;

  logger.info('OpenFDA adverse events complete', {
    drugName,
    totalReports,
    topCount: adverseEvents?.length,
    specificReactionCount,
  });

  return {
    drugName,
    ...(adverseEvents !== undefined ? { adverseEvents } : {}),
    ...(specificReactionCount !== undefined ? { specificReactionCount } : {}),
    ...(totalReports !== undefined ? { totalReports } : {}),
    query,
  };
}

async function searchDrugLabels(drugName: string): Promise<{
  drugName: string;
  labels?: DrugLabel[];
  query: string;
}> {
  logger.info('Searching OpenFDA drug labels', { drugName });

  const searchQuery = `openfda.generic_name:"${drugName}"+OR+openfda.brand_name:"${drugName}"`;
  const url = buildUrl('/drug/label.json', {
    search: searchQuery,
    limit: '3',
  });

  try {
    const response = await fetch(url);
    if (!response.ok) {
      logger.warn('OpenFDA label search failed', { status: response.status });
      return { drugName, query: `${drugName} (labels)` };
    }

    const data = (await response.json()) as OpenFdaLabelResponse;
    if (!data.results || data.results.length === 0) {
      return { drugName, labels: [], query: `${drugName} (labels)` };
    }

    const labels: DrugLabel[] = data.results.map((r) => ({
      brandName: r.openfda?.brand_name?.[0] ?? 'Unknown',
      genericName: r.openfda?.generic_name?.[0] ?? drugName,
      warnings: truncateText(r.warnings?.[0]),
      adverseReactions: truncateText(r.adverse_reactions?.[0]),
      indications: truncateText(r.indications_and_usage?.[0]),
      dosage: truncateText(r.dosage_and_administration?.[0]),
      ...(r.openfda?.spl_set_id?.[0]
        ? {
            url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${r.openfda.spl_set_id[0]}`,
          }
        : {}),
    }));

    logger.info('OpenFDA label search complete', { drugName, labelCount: labels.length });
    return { drugName, labels, query: `${drugName} (labels)` };
  } catch (error) {
    logger.error('OpenFDA label search error', { error: String(error) });
    return { drugName, query: `${drugName} (labels)` };
  }
}
