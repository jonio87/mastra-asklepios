import type { Tool } from '@mastra/core/tools';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { getBiomedicalTools } from '../clients/biomedical-mcp.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { extractAllIds } from '../utils/id-extractor.js';
import { logger } from '../utils/logger.js';

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

/**
 * Find a biomedical MCP tool by partial name match.
 * Tools are namespaced as `serverName_toolName` — this searches for a suffix match.
 */
function findMcpTool(tools: Record<string, Tool>, ...candidates: string[]): Tool | undefined {
  for (const candidate of candidates) {
    // Exact match first
    const exact = tools[candidate];
    if (exact) return exact;
    // Suffix match (tool name without server prefix)
    const entry = Object.entries(tools).find(([name]) => name.endsWith(`_${candidate}`));
    if (entry) return entry[1];
  }
  return undefined;
}

/**
 * Execute an MCP tool and extract text content from the result.
 * MCP tools return various formats — normalize to string.
 */
async function executeMcpTool(
  tool: Tool,
  input: Record<string, unknown>,
): Promise<string | undefined> {
  if (!tool.execute) return undefined;
  try {
    const result = await tool.execute(input, {} as never);
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') return JSON.stringify(result);
    return undefined;
  } catch (err) {
    logger.warn('MCP tool execution failed', {
      toolId: tool.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * Parse MCP article search results into ResearchFinding objects.
 * Handles various response formats from BioMCP/BioThings article tools.
 */
function parseArticleResults(raw: string, maxResults: number): ResearchFinding[] {
  try {
    const data = JSON.parse(raw) as unknown;
    const findings: ResearchFinding[] = [];

    // Handle array of articles
    const articles = Array.isArray(data) ? data : [];
    for (const article of articles.slice(0, maxResults)) {
      if (!article || typeof article !== 'object') continue;
      const a = article as Record<string, unknown>;
      findings.push({
        source: 'PubMed',
        title: String(a['title'] ?? a['name'] ?? 'Untitled'),
        summary: String(a['abstract'] ?? a['summary'] ?? a['description'] ?? ''),
        relevance: 0.7,
        url: String(
          a['url'] ??
            a['link'] ??
            (a['pmid'] ? `https://pubmed.ncbi.nlm.nih.gov/${a['pmid']}/` : ''),
        ),
        evidenceLevel: 'unknown',
      });
    }

    // If we got a text response with embedded results, create a single finding
    if (
      findings.length === 0 &&
      typeof data === 'object' &&
      data !== null &&
      !Array.isArray(data)
    ) {
      findings.push({
        source: 'PubMed',
        title: 'Search results',
        summary: raw.slice(0, 500),
        relevance: 0.6,
        url: '',
        evidenceLevel: 'unknown',
      });
    }

    return findings;
  } catch {
    // Raw text response — wrap as single finding
    if (raw.length > 10) {
      return [
        {
          source: 'PubMed',
          title: 'Search results',
          summary: raw.slice(0, 500),
          relevance: 0.6,
          evidenceLevel: 'unknown',
        },
      ];
    }
    return [];
  }
}

/**
 * Parse MCP disease/gene search results into ResearchFinding objects.
 */
function parseDiseaseResults(raw: string): ResearchFinding[] {
  try {
    const data = JSON.parse(raw) as unknown;
    const findings: ResearchFinding[] = [];

    const items = Array.isArray(data) ? data : [];
    for (const item of items.slice(0, 10)) {
      if (!item || typeof item !== 'object') continue;
      const d = item as Record<string, unknown>;
      findings.push({
        source: 'OMIM/BioMCP',
        title: String(d['title'] ?? d['name'] ?? d['diseaseName'] ?? 'Unknown'),
        summary: String(d['description'] ?? d['summary'] ?? d['definition'] ?? ''),
        relevance: 0.8,
        url: String(d['url'] ?? d['link'] ?? ''),
        evidenceLevel: 'review',
      });
    }

    if (findings.length === 0 && raw.length > 10) {
      findings.push({
        source: 'OMIM/BioMCP',
        title: 'Disease search results',
        summary: raw.slice(0, 500),
        relevance: 0.6,
        evidenceLevel: 'unknown',
      });
    }

    return findings;
  } catch {
    if (raw.length > 10) {
      return [
        {
          source: 'OMIM/BioMCP',
          title: 'Disease search results',
          summary: raw.slice(0, 500),
          relevance: 0.6,
          evidenceLevel: 'unknown',
        },
      ];
    }
    return [];
  }
}

export const deepResearchTool = createTool({
  id: 'deep-research',
  description:
    'Conduct deep research on a medical topic using multiple biomedical MCP servers (BioMCP, BioThings, BioContextAI, Open Targets). Searches across PubMed, OMIM, gene databases, and disease databases to compile comprehensive research findings. Use for rare disease investigation, differential diagnosis research, or evidence synthesis. This is a long-running operation.',
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

    logger.info('Starting deep research via MCP', { query, focusAreas, maxSources });

    // ─── Cross-session dedup: check what's already researched ──────────
    const patientId = context?.match(/patient[:\-\s]+(\S+)/i)?.[1] ?? 'unknown';
    if (patientId !== 'unknown') {
      try {
        const store = getClinicalStore();
        const coverage = await store.getRecentFindingsForQuery({
          patientId,
          queryTerms: [query, ...(focusAreas ?? [])],
          maxAgeDays: 30,
        });
        if (coverage.coveragePercent >= 80) {
          logger.info('Research query already well-covered, returning cached results', {
            coveragePercent: coverage.coveragePercent,
            coveredTerms: coverage.coveredTerms,
          });
          return buildReportFromExistingFindings(coverage.findings, query);
        }
        if (coverage.coveredTerms.length > 0) {
          logger.info('Partial coverage found, will skip covered areas', {
            coveredTerms: coverage.coveredTerms,
          });
        }
      } catch {
        // Non-blocking — proceed with full research if dedup check fails
      }
    }

    const tools = await getBiomedicalTools();
    const findings: ResearchFinding[] = [];

    // Search PubMed via BioMCP article searcher
    const articleTool = findMcpTool(
      tools,
      'biomcp_article_searcher',
      'article_searcher',
      'search_articles',
    );
    if (articleTool) {
      const pubmedQueries = generateSearchQueries(query, focusAreas);
      for (const searchQuery of pubmedQueries) {
        const raw = await executeMcpTool(articleTool, { query: searchQuery });
        if (raw) {
          const perQuery = Math.ceil(maxSources / pubmedQueries.length);
          findings.push(...parseArticleResults(raw, perQuery));
        }
      }
    } else {
      logger.warn('No article search MCP tool available — PubMed search skipped');
    }

    // Search disease/gene databases via BioMCP or BioThings
    const diseaseTool = findMcpTool(
      tools,
      'biomcp_disease_searcher',
      'disease_searcher',
      'search_diseases',
    );
    if (diseaseTool) {
      const raw = await executeMcpTool(diseaseTool, { query });
      if (raw) findings.push(...parseDiseaseResults(raw));
    }

    // Try gene search for genetic conditions
    const geneTool = findMcpTool(tools, 'biomcp_gene_searcher', 'gene_searcher', 'query_mygene');
    if (geneTool) {
      const raw = await executeMcpTool(geneTool, { query });
      if (raw) {
        const geneFindings = parseDiseaseResults(raw).map((f) => ({
          ...f,
          source: 'Gene DB',
        }));
        findings.push(...geneFindings);
      }
    }

    findings.sort((a, b) => b.relevance - a.relevance);
    const topFindings = findings.slice(0, maxSources);

    const synthesis = generateSynthesis(query, topFindings, context);
    const gaps = identifyGaps(topFindings, focusAreas);
    const suggestedFollowUp = generateFollowUpQueries(query, topFindings, gaps);

    logger.info('Deep research complete', { query, findingCount: topFindings.length });

    const report = {
      query,
      findings: topFindings,
      synthesis,
      gaps,
      suggestedFollowUp,
      timestamp: new Date().toISOString(),
    };

    // Auto-capture: persist findings + query to research store (fire-and-forget)
    persistResearchReport(report, context).catch((err: unknown) => {
      logger.warn('Auto-capture of research report failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return report;
  },
});

/** Auto-persist research report to Layer 2B — findings + query record with dedup. */
async function persistResearchReport(report: ResearchReport, context?: string): Promise<void> {
  const store = getClinicalStore();
  const patientId = context?.match(/patient[:\-\s]+(\S+)/i)?.[1] ?? 'unknown';
  const today = new Date().toISOString().split('T')[0] ?? '';
  const queryId = `rquery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Persist each finding with dedup (external ID or content hash)
  const findingIds: string[] = [];
  let duplicates = 0;
  for (const finding of report.findings) {
    const findingId = `finding-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Extract structured external IDs from title + summary
    const ids = extractAllIds(`${finding.title} ${finding.summary} ${finding.url ?? ''}`);
    const firstId = ids[0];

    const result = await store.addResearchFinding({
      id: findingId,
      patientId,
      source: finding.source,
      sourceTool: 'deepResearch',
      title: finding.title,
      summary: finding.summary,
      date: today,
      relevance: finding.relevance,
      evidenceLevel: finding.evidenceLevel,
      researchQueryId: queryId,
      ...(finding.url ? { url: finding.url } : {}),
      ...(firstId ? { externalId: firstId.id, externalIdType: firstId.type } : {}),
    });

    findingIds.push(result.id);
    if (result.duplicate) duplicates++;
  }

  // Persist the query record
  await store.addResearchQuery({
    id: queryId,
    patientId,
    query: report.query,
    toolUsed: 'deepResearch',
    date: today,
    resultCount: report.findings.length,
    findingIds,
    synthesis: report.synthesis,
    gaps: report.gaps,
    suggestedFollowUp: report.suggestedFollowUp,
  });

  logger.info('Auto-captured research report', {
    queryId,
    findingCount: findingIds.length,
    duplicates,
    patientId,
  });
}

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

/**
 * Build a ResearchReport from existing (cached) findings stored in Layer 2B.
 * Used when cross-session dedup determines the query is already well-covered.
 */
function buildReportFromExistingFindings(
  storedFindings: Array<{
    source: string;
    title: string;
    summary: string;
    relevance?: number | undefined;
    url?: string | undefined;
    evidenceLevel?: string | undefined;
    date: string;
  }>,
  query: string,
): ResearchReport {
  const findings: ResearchFinding[] = storedFindings.map((f) => ({
    source: f.source,
    title: f.title,
    summary: f.summary,
    relevance: f.relevance ?? 0.5,
    url: f.url,
    evidenceLevel: (f.evidenceLevel as ResearchFinding['evidenceLevel']) ?? 'unknown',
  }));

  findings.sort((a, b) => b.relevance - a.relevance);

  const synthesis = `Research on "${query}" returned ${findings.length} cached findings from a previous session (≥80% coverage). ${generateSynthesis(query, findings)}`;
  const gaps = identifyGaps(findings);
  const suggestedFollowUp = generateFollowUpQueries(query, findings, gaps);

  return {
    query,
    findings,
    synthesis,
    gaps,
    suggestedFollowUp,
    timestamp: new Date().toISOString(),
  };
}
