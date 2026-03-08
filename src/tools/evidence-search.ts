import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { logger } from '../utils/logger.js';
import { NCBI_BASE_URL, ncbiFetch } from '../utils/ncbi-rate-limiter.js';

const EvidenceResultSchema = z.object({
  title: z.string().describe('Title of the systematic review or evidence summary'),
  source: z
    .enum(['cochrane', 'pubmed-systematic-review', 'pubmed-meta-analysis', 'pubmed-rct'])
    .describe('Source database and evidence type'),
  evidenceLevel: z
    .enum(['systematic-review', 'meta-analysis', 'rct', 'guideline'])
    .describe('Level of evidence'),
  authors: z.array(z.string()).optional().describe('Author list'),
  journal: z.string().optional().describe('Journal name'),
  publicationDate: z.string().optional().describe('Publication date'),
  pmid: z.string().optional().describe('PubMed ID if available'),
  doi: z.string().optional().describe('DOI if available'),
  abstract: z.string().optional().describe('Abstract text'),
  url: z.string().describe('Link to the evidence source'),
});

export type EvidenceResult = z.infer<typeof EvidenceResultSchema>;

/** PubMed publication type filters for high-quality evidence. */
const EVIDENCE_FILTERS: Record<string, string> = {
  'systematic-review': 'systematic review[pt]',
  'meta-analysis': 'meta-analysis[pt]',
  rct: 'randomized controlled trial[pt]',
  guideline: 'practice guideline[pt]',
};

/** Build a PICO-structured search query for PubMed. */
function buildPicoQuery(pico: {
  population?: string;
  intervention?: string;
  comparison?: string;
  outcome?: string;
}): string {
  const parts: string[] = [];
  if (pico.population) parts.push(`(${pico.population})`);
  if (pico.intervention) parts.push(`(${pico.intervention})`);
  if (pico.comparison) parts.push(`(${pico.comparison})`);
  if (pico.outcome) parts.push(`(${pico.outcome})`);
  return parts.join(' AND ');
}

// --- XML parsing helpers (shared pattern with pubmed-search) ---

function extractXmlText(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = regex.exec(xml);
  return match?.[1]?.trim() ?? '';
}

function extractAllXmlText(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const results: string[] = [];
  for (const match of xml.matchAll(regex)) {
    const text = match[1]?.trim();
    if (text) results.push(text);
  }
  return results;
}

function stripXmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim();
}

/** Parsed article data extracted from PubmedArticle XML blocks. */
interface ParsedArticle {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  year: string;
  doi: string | undefined;
}

/** Parse all PubmedArticle XML blocks from an efetch response into structured data. */
function parseArticlesFromXml(xml: string): ParsedArticle[] {
  const articleRegex = /<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g;
  const articles: ParsedArticle[] = [];

  for (const match of xml.matchAll(articleRegex)) {
    const articleXml = match[0];
    const medlineCitation = extractXmlText(articleXml, 'MedlineCitation');
    const article = extractXmlText(medlineCitation, 'Article');
    const pmid = extractXmlText(medlineCitation, 'PMID');
    const title = stripXmlTags(extractXmlText(article, 'ArticleTitle'));

    // Abstract
    const abstractSection = extractXmlText(article, 'Abstract');
    const abstractParts = extractAllXmlText(abstractSection, 'AbstractText');
    const abstract = abstractParts.map(stripXmlTags).join('\n\n');

    // Authors
    const authorListXml = extractXmlText(article, 'AuthorList');
    const authorBlocks = extractAllXmlText(authorListXml, 'Author');
    const authors = authorBlocks.map((a) => {
      const lastName = extractXmlText(a, 'LastName');
      const foreName = extractXmlText(a, 'ForeName');
      return lastName && foreName ? `${lastName} ${foreName}` : lastName || 'Unknown';
    });

    // Journal and date
    const journalXml = extractXmlText(article, 'Journal');
    const journal =
      extractXmlText(journalXml, 'Title') || extractXmlText(journalXml, 'ISOAbbreviation');
    const pubDateXml = extractXmlText(journalXml, 'PubDate');
    const year = extractXmlText(pubDateXml, 'Year');

    // DOI
    const pubmedData = extractXmlText(articleXml, 'PubmedData');
    const articleIdList = extractXmlText(pubmedData, 'ArticleIdList');
    const articleIds = extractAllXmlText(articleIdList, 'ArticleId');
    let doi: string | undefined;
    for (const aid of articleIds) {
      const stripped = stripXmlTags(aid);
      if (stripped.includes('10.')) {
        doi = stripped;
        break;
      }
    }

    articles.push({ pmid, title, abstract, authors, journal, year, doi });
  }

  return articles;
}

interface PubMedSummaryArticle {
  title?: string;
  source?: string;
  pubdate?: string;
  authors?: Array<{ name?: string }>;
  elocationid?: string;
}

/** Map evidence type string to PubMed source identifier. */
function mapEvidenceSource(evidenceType: string): EvidenceResult['source'] {
  if (evidenceType === 'systematic-review') return 'pubmed-systematic-review';
  if (evidenceType === 'meta-analysis') return 'pubmed-meta-analysis';
  return 'pubmed-rct';
}

/** Convert parsed XML articles to EvidenceResult array. */
function parsedArticlesToEvidence(parsed: ParsedArticle[], evidenceType: string): EvidenceResult[] {
  const source = mapEvidenceSource(evidenceType);
  return parsed.map((a) => ({
    title: a.title || 'Untitled',
    source,
    evidenceLevel: evidenceType as EvidenceResult['evidenceLevel'],
    authors: a.authors.length > 0 ? a.authors : undefined,
    journal: a.journal || undefined,
    publicationDate: a.year || undefined,
    pmid: a.pmid || undefined,
    ...(a.doi ? { doi: a.doi } : {}),
    ...(a.abstract ? { abstract: a.abstract } : {}),
    url: a.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/` : '',
  }));
}

/** Fallback: fetch article summaries via esummary when efetch fails. */
async function fetchEvidenceViaSummary(
  ids: string[],
  evidenceType: string,
): Promise<EvidenceResult[]> {
  const summaryUrl = `${NCBI_BASE_URL}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
  const summaryResponse = await ncbiFetch(summaryUrl);
  if (!summaryResponse.ok) return [];

  const summaryData = (await summaryResponse.json()) as {
    result?: Record<string, PubMedSummaryArticle>;
  };
  const result = summaryData.result ?? {};
  const source = mapEvidenceSource(evidenceType);
  const results: EvidenceResult[] = [];

  for (const id of ids) {
    const article = result[id];
    if (!article || typeof article !== 'object' || !('title' in article)) continue;

    results.push({
      title: article.title ?? 'Untitled',
      source,
      evidenceLevel: evidenceType as EvidenceResult['evidenceLevel'],
      authors: article.authors?.map((a) => a.name ?? 'Unknown'),
      journal: article.source,
      publicationDate: article.pubdate,
      pmid: id,
      ...(article.elocationid ? { doi: article.elocationid } : {}),
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
    });
  }

  return results;
}

/** Search PubMed IDs via esearch for a given query. */
async function searchPubMedIds(query: string, maxResults: number): Promise<string[]> {
  const searchUrl = `${NCBI_BASE_URL}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json`;
  const searchResponse = await ncbiFetch(searchUrl);
  if (!searchResponse.ok) return [];

  const searchData = (await searchResponse.json()) as {
    esearchresult?: { idlist?: string[] };
  };
  return searchData.esearchresult?.idlist ?? [];
}

async function searchPubMedForEvidence(
  query: string,
  evidenceType: string,
  maxResults: number,
): Promise<EvidenceResult[]> {
  const filter = EVIDENCE_FILTERS[evidenceType];
  if (!filter) return [];

  const ids = await searchPubMedIds(`${query} AND ${filter}`, maxResults);
  if (ids.length === 0) return [];

  // Fetch abstracts via efetch
  const efetchUrl = `${NCBI_BASE_URL}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&rettype=xml&retmode=xml`;
  const efetchResponse = await ncbiFetch(efetchUrl);

  if (efetchResponse.ok) {
    const xml = await efetchResponse.text();
    return parsedArticlesToEvidence(parseArticlesFromXml(xml), evidenceType);
  }

  // Fallback to esummary (no abstracts)
  return fetchEvidenceViaSummary(ids, evidenceType);
}

/** Convert parsed XML articles to Cochrane EvidenceResult array. */
function parsedArticlesToCochrane(parsed: ParsedArticle[]): EvidenceResult[] {
  return parsed.map((a) => ({
    title: a.title || 'Untitled',
    source: 'cochrane' as const,
    evidenceLevel: 'systematic-review' as const,
    authors: a.authors.length > 0 ? a.authors : undefined,
    journal: 'Cochrane Database of Systematic Reviews',
    publicationDate: a.year || undefined,
    pmid: a.pmid || undefined,
    ...(a.doi ? { doi: a.doi } : {}),
    ...(a.abstract ? { abstract: a.abstract } : {}),
    url: a.doi
      ? `https://doi.org/${a.doi}`
      : a.pmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`
        : '',
  }));
}

/** Search Cochrane Library via their website search (no API key required). */
async function searchCochrane(query: string, maxResults: number): Promise<EvidenceResult[]> {
  // Cochrane Library doesn't have a free public API, but we can search their
  // reviews via PubMed since all Cochrane reviews are indexed there
  const cochraneQuery = `${query} AND "Cochrane Database Syst Rev"[journal]`;
  const ids = await searchPubMedIds(cochraneQuery, maxResults);
  if (ids.length === 0) return [];

  // Fetch via efetch for full abstracts
  const efetchUrl = `${NCBI_BASE_URL}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&rettype=xml&retmode=xml`;
  const efetchResponse = await ncbiFetch(efetchUrl);

  if (!efetchResponse.ok) return [];

  const xml = await efetchResponse.text();
  return parsedArticlesToCochrane(parseArticlesFromXml(xml));
}

export const evidenceSearchTool = createTool({
  id: 'evidence-search',
  description:
    'Search for high-quality evidence: Cochrane systematic reviews, meta-analyses, RCTs, and clinical practice guidelines. Supports PICO-structured queries (Population, Intervention, Comparison, Outcome). Searches Cochrane Library (via PubMed indexing) and PubMed with evidence-type filters.',
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe('Free-text search query (combined with PICO components if provided)'),
    population: z
      .string()
      .optional()
      .describe('PICO: Patient population (e.g., "chronic craniofacial pain")'),
    intervention: z
      .string()
      .optional()
      .describe('PICO: Intervention (e.g., "greater occipital nerve block")'),
    comparison: z.string().optional().describe('PICO: Comparison (e.g., "placebo", "sham")'),
    outcome: z.string().optional().describe('PICO: Outcome (e.g., "pain reduction", "allodynia")'),
    evidenceTypes: z
      .array(z.enum(['systematic-review', 'meta-analysis', 'rct', 'guideline']))
      .optional()
      .describe('Evidence types to include (default: all types)'),
    includeCochrane: z
      .boolean()
      .optional()
      .describe('Include Cochrane Library search (default: true)'),
    maxResults: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum results per evidence type (default: 5)'),
  }),
  outputSchema: z.object({
    results: z.array(EvidenceResultSchema).describe('Evidence search results sorted by quality'),
    totalByType: z.record(z.string(), z.number()).describe('Count of results by evidence type'),
    query: z.string().describe('The search query that was executed'),
  }),
  execute: async (inputData) => {
    const {
      query,
      population,
      intervention,
      comparison,
      outcome,
      evidenceTypes = ['systematic-review', 'meta-analysis', 'rct', 'guideline'],
      includeCochrane = true,
      maxResults = 5,
    } = inputData;

    // Build search query from PICO + free text
    const picoQuery = buildPicoQuery({
      ...(population !== undefined ? { population } : {}),
      ...(intervention !== undefined ? { intervention } : {}),
      ...(comparison !== undefined ? { comparison } : {}),
      ...(outcome !== undefined ? { outcome } : {}),
    });
    const searchQuery = [picoQuery, query].filter(Boolean).join(' AND ');

    if (!searchQuery) {
      return { results: [], totalByType: {}, query: '' };
    }

    logger.info('Evidence search', { searchQuery, evidenceTypes, includeCochrane });

    const allResults: EvidenceResult[] = [];

    // Search Cochrane first (highest quality)
    if (includeCochrane) {
      const cochraneResults = await searchCochrane(searchQuery, maxResults);
      allResults.push(...cochraneResults);
    }

    // Search PubMed for each evidence type
    for (const evidenceType of evidenceTypes) {
      const results = await searchPubMedForEvidence(searchQuery, evidenceType, maxResults);
      allResults.push(...results);
    }

    // Deduplicate by PMID
    const seen = new Set<string>();
    const deduped = allResults.filter((r) => {
      if (!r.pmid) return true;
      if (seen.has(r.pmid)) return false;
      seen.add(r.pmid);
      return true;
    });

    // Count by type
    const totalByType: Record<string, number> = {};
    for (const r of deduped) {
      totalByType[r.source] = (totalByType[r.source] ?? 0) + 1;
    }

    // Sort: cochrane first, then systematic reviews, meta-analyses, RCTs, guidelines
    const evidenceOrder: Record<string, number> = {
      cochrane: 0,
      'pubmed-systematic-review': 1,
      'pubmed-meta-analysis': 2,
      'pubmed-rct': 3,
    };
    deduped.sort((a, b) => (evidenceOrder[a.source] ?? 99) - (evidenceOrder[b.source] ?? 99));

    logger.info('Evidence search complete', {
      query: searchQuery,
      resultCount: deduped.length,
      totalByType,
    });

    return { results: deduped, totalByType, query: searchQuery };
  },
});
