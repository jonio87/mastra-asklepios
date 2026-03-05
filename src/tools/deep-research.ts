import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { logger } from '../utils/logger.js';
import { NCBI_BASE_URL, ncbiFetch } from '../utils/ncbi-rate-limiter.js';

const ResearchFindingSchema = z.object({
  source: z.string().describe('Source of the finding (e.g., PubMed, OMIM, case report)'),
  title: z.string().describe('Title of the source document'),
  summary: z.string().describe('Key finding summary'),
  relevance: z.number().min(0).max(1).describe('Relevance score (0-1)'),
  url: z.string().optional().describe('URL to the source'),
  evidenceLevel: z
    .enum([
      'case-report',
      'case-series',
      'cohort',
      'rct',
      'meta-analysis',
      'review',
      'expert-opinion',
      'unknown',
    ])
    .describe('Level of evidence'),
});

export type ResearchFinding = z.infer<typeof ResearchFindingSchema>;

const ResearchReportSchema = z.object({
  query: z.string().describe('The research query'),
  findings: z.array(ResearchFindingSchema).describe('Research findings'),
  synthesis: z.string().describe('Synthesized summary of all findings'),
  gaps: z.array(z.string()).describe('Identified knowledge gaps'),
  suggestedFollowUp: z.array(z.string()).describe('Suggested follow-up research queries'),
  timestamp: z.string().describe('When the research was conducted'),
});

export type ResearchReport = z.infer<typeof ResearchReportSchema>;

export const deepResearchTool = createTool({
  id: 'deep-research',
  description:
    'Conduct deep web research on a medical topic using multiple sources. This tool searches across PubMed, OMIM, and medical databases to compile comprehensive research findings. Use for rare disease investigation, differential diagnosis research, or evidence synthesis. This is a long-running operation.',
  inputSchema: z.object({
    query: z.string().describe('Detailed research query describing what to investigate'),
    context: z
      .string()
      .optional()
      .describe('Additional context about the patient case or research direction'),
    focusAreas: z
      .array(z.string())
      .optional()
      .describe(
        'Specific areas to focus the research on (e.g., ["genetics", "treatment options"])',
      ),
    maxSources: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe('Maximum number of sources to include (default: 20)'),
  }),
  outputSchema: ResearchReportSchema,
  execute: async (inputData) => {
    const { query, context, focusAreas, maxSources = 20 } = inputData;

    logger.info('Starting deep research', { query, focusAreas, maxSources });

    const findings: ResearchFinding[] = [];

    const pubmedQueries = generateSearchQueries(query, focusAreas);

    for (const searchQuery of pubmedQueries) {
      const pubmedFindings = await searchPubMedForFindings(
        searchQuery,
        Math.ceil(maxSources / pubmedQueries.length),
      );
      findings.push(...pubmedFindings);
    }

    const omimFindings = await searchOmimForFindings(query);
    findings.push(...omimFindings);

    findings.sort((a, b) => b.relevance - a.relevance);
    const topFindings = findings.slice(0, maxSources);

    const synthesis = generateSynthesis(query, topFindings, context);
    const gaps = identifyGaps(topFindings, focusAreas);
    const suggestedFollowUp = generateFollowUpQueries(query, topFindings, gaps);

    logger.info('Deep research complete', { query, findingCount: topFindings.length });

    return {
      query,
      findings: topFindings,
      synthesis,
      gaps,
      suggestedFollowUp,
      timestamp: new Date().toISOString(),
    };
  },
});

function generateSearchQueries(query: string, focusAreas?: string[]): string[] {
  const queries = [query];

  if (focusAreas) {
    for (const area of focusAreas) {
      queries.push(`${query} AND ${area}`);
    }
  }

  if (
    query.toLowerCase().includes('rare disease') ||
    query.toLowerCase().includes('rare disorder')
  ) {
    queries.push(`${query} case report`);
  }

  return queries.slice(0, 5);
}

async function searchPubMedForFindings(
  query: string,
  maxResults: number,
): Promise<ResearchFinding[]> {
  const searchUrl = `${NCBI_BASE_URL}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json`;

  const response = await ncbiFetch(searchUrl);
  if (!response.ok) return [];

  const data = (await response.json()) as { esearchresult?: { idlist?: string[] } };
  const ids = data.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  const summaryUrl = `${NCBI_BASE_URL}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
  const summaryResponse = await ncbiFetch(summaryUrl);
  if (!summaryResponse.ok) return [];

  const summaryData = (await summaryResponse.json()) as {
    result?: Record<string, { title?: string; source?: string; pubdate?: string }>;
  };
  const result = summaryData.result ?? {};

  return ids.reduce<ResearchFinding[]>((acc, id) => {
    const article = result[id];
    if (!article || typeof article !== 'object' || !('title' in article)) return acc;
    acc.push({
      source: 'PubMed',
      title: (article.title as string) ?? 'Untitled',
      summary: `Published in ${(article.source as string) ?? 'Unknown'} (${(article.pubdate as string) ?? 'Unknown'})`,
      relevance: 0.7,
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      evidenceLevel: 'unknown',
    });
    return acc;
  }, []);
}

const OMIM_PREFIX_TO_EVIDENCE: Record<string, ResearchFinding['evidenceLevel']> = {
  '*': 'review', // gene with known sequence
  '#': 'cohort', // phenotype, molecular basis known
  '%': 'unknown', // confirmed mendelian locus
  '+': 'review', // gene with known sequence and phenotype
  '^': 'unknown', // entry has been removed or moved
};

interface OmimEntry {
  mimNumber?: number;
  prefix?: string;
  status?: string;
  titles?: { preferredTitle?: string };
  geneMap?: { geneSymbols?: string; geneName?: string; chromosomeLocation?: string };
}

function mapOmimEntryToFinding(entry: OmimEntry | undefined): ResearchFinding | undefined {
  if (!entry) return undefined;

  const prefix = entry.prefix ?? '';
  const mimNumber = entry.mimNumber ?? 0;
  const title = entry.titles?.preferredTitle ?? 'Unknown entry';
  const geneSymbols = entry.geneMap?.geneSymbols ?? '';
  const geneName = entry.geneMap?.geneName ?? '';
  const location = entry.geneMap?.chromosomeLocation ?? '';

  const summaryParts = [`MIM #${mimNumber}`];
  if (geneSymbols) summaryParts.push(`Gene: ${geneSymbols}`);
  if (geneName) summaryParts.push(`(${geneName})`);
  if (location) summaryParts.push(`at ${location}`);

  return {
    source: 'OMIM',
    title: `${prefix}${mimNumber} ${title}`,
    summary: summaryParts.join(' — '),
    relevance: prefix === '#' || prefix === '*' ? 0.8 : 0.6,
    url: `https://omim.org/entry/${mimNumber}`,
    evidenceLevel: OMIM_PREFIX_TO_EVIDENCE[prefix] ?? 'unknown',
  };
}

async function searchOmimForFindings(query: string): Promise<ResearchFinding[]> {
  const apiKey = process.env['OMIM_API_KEY'];

  if (!apiKey) {
    logger.info('OMIM search skipped — no API key', { query });
    return [
      {
        source: 'OMIM',
        title: `OMIM search: ${query}`,
        summary:
          'OMIM integration requires API key. Configure OMIM_API_KEY environment variable for full access.',
        relevance: 0.5,
        url: `https://omim.org/search?search=${encodeURIComponent(query)}`,
        evidenceLevel: 'unknown',
      },
    ];
  }

  logger.info('Searching OMIM', { query });

  const url = `https://api.omim.org/api/entry/search?search=${encodeURIComponent(query)}&apiKey=${encodeURIComponent(apiKey)}&format=json&limit=10`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      logger.error('OMIM search failed', { status: response.status });
      return [];
    }

    const data = (await response.json()) as {
      omim?: {
        searchResponse?: {
          endIndex?: number;
          entryList?: Array<{
            entry?: {
              mimNumber?: number;
              prefix?: string;
              status?: string;
              titles?: {
                preferredTitle?: string;
              };
              geneMap?: {
                geneSymbols?: string;
                geneName?: string;
                chromosomeLocation?: string;
              };
            };
          }>;
        };
      };
    };

    const entries = data.omim?.searchResponse?.entryList ?? [];

    return entries.reduce<ResearchFinding[]>((acc, item) => {
      const finding = mapOmimEntryToFinding(item.entry);
      if (finding) acc.push(finding);
      return acc;
    }, []);
  } catch (error) {
    logger.error('OMIM search error', { error: String(error) });
    return [];
  }
}

function generateSynthesis(query: string, findings: ResearchFinding[], context?: string): string {
  if (findings.length === 0) {
    return `No research findings were found for: ${query}. Consider broadening the search terms or using alternative medical terminology.`;
  }

  const sourceCount = new Map<string, number>();
  for (const f of findings) {
    sourceCount.set(f.source, (sourceCount.get(f.source) ?? 0) + 1);
  }

  const sourceSummary = [...sourceCount.entries()]
    .map(([source, count]) => `${count} from ${source}`)
    .join(', ');
  const contextNote = context ? ` Research was conducted in the context of: ${context}.` : '';

  return `Research on "${query}" yielded ${findings.length} findings (${sourceSummary}).${contextNote} Top findings are sorted by relevance. Review individual sources for detailed evidence.`;
}

function identifyGaps(findings: ResearchFinding[], focusAreas?: string[]): string[] {
  const gaps: string[] = [];

  if (findings.every((f) => f.evidenceLevel === 'unknown' || f.evidenceLevel === 'case-report')) {
    gaps.push(
      'No high-level evidence (RCTs, meta-analyses) found — evidence base is limited to case reports',
    );
  }

  if (focusAreas) {
    for (const area of focusAreas) {
      const areaFindings = findings.filter(
        (f) =>
          f.title.toLowerCase().includes(area.toLowerCase()) ||
          f.summary.toLowerCase().includes(area.toLowerCase()),
      );
      if (areaFindings.length === 0) {
        gaps.push(`No findings for focus area: ${area}`);
      }
    }
  }

  if (findings.length < 3) {
    gaps.push('Very few research sources found — this may indicate an ultra-rare condition');
  }

  return gaps;
}

function generateFollowUpQueries(
  query: string,
  findings: ResearchFinding[],
  gaps: string[],
): string[] {
  const followUp: string[] = [];

  for (const gap of gaps) {
    if (gap.includes('focus area:')) {
      const area = gap.replace('No findings for focus area: ', '');
      followUp.push(`${query} ${area}`);
    }
  }

  if (findings.length > 0) {
    followUp.push(`${query} differential diagnosis`);
    followUp.push(`${query} treatment guidelines`);
  }

  return followUp.slice(0, 5);
}
