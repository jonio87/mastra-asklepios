import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { logger } from '../utils/logger.js';
import { NCBI_BASE_URL, ncbiFetch } from '../utils/ncbi-rate-limiter.js';

const PubMedArticleSchema = z.object({
  pmid: z.string().describe('PubMed article ID'),
  title: z.string().describe('Article title'),
  abstract: z.string().describe('Article abstract text'),
  authors: z.array(z.string()).describe('List of author names'),
  journal: z.string().describe('Journal name'),
  publicationDate: z.string().describe('Publication date (YYYY-MM-DD or YYYY)'),
  doi: z.string().optional().describe('Digital Object Identifier'),
  url: z.string().describe('Link to PubMed article'),
  meshTerms: z.array(z.string()).optional().describe('MeSH subject headings'),
  publicationType: z
    .array(z.string())
    .optional()
    .describe('Publication types (e.g., Review, Clinical Trial, Case Reports)'),
});

export type PubMedArticle = z.infer<typeof PubMedArticleSchema>;

const eSearchResultSchema = z.object({
  esearchresult: z.object({
    idlist: z.array(z.string()),
    count: z.string(),
  }),
});

const eSummaryArticleSchema = z.object({
  uid: z.string(),
  title: z.string().optional(),
  sorttitle: z.string().optional(),
  source: z.string().optional(),
  pubdate: z.string().optional(),
  authors: z
    .array(
      z.object({
        name: z.string().optional(),
      }),
    )
    .optional(),
  elocationid: z.string().optional(),
});

const eSummaryResultSchema = z.object({
  result: z.record(z.string(), z.unknown()),
});

const eLinkResultSchema = z.object({
  linksets: z
    .array(
      z.object({
        linksetdbs: z
          .array(
            z.object({
              linkname: z.string().optional(),
              links: z.array(z.string()).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

// --- XML parsing helpers for efetch responses ---

/** Extract text content between XML tags. Returns empty string if not found. */
function extractXmlText(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = regex.exec(xml);
  return match?.[1]?.trim() ?? '';
}

/** Extract all occurrences of text between XML tags. */
function extractAllXmlText(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const results: string[] = [];
  for (const match of xml.matchAll(regex)) {
    const text = match[1]?.trim();
    if (text) results.push(text);
  }
  return results;
}

/** Strip XML tags from text. */
function stripXmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim();
}

/** Extract DOI from article XML (ELocationID or ArticleIdList). */
function extractDoi(articleXml: string, articleSection: string): string | undefined {
  const elocationIds = extractAllXmlText(articleSection, 'ELocationID');
  for (const eloc of elocationIds) {
    if (eloc) {
      return stripXmlTags(eloc);
    }
  }
  const pubmedData = extractXmlText(articleXml, 'PubmedData');
  const articleIdList = extractXmlText(pubmedData, 'ArticleIdList');
  const articleIds = extractAllXmlText(articleIdList, 'ArticleId');
  for (const aid of articleIds) {
    const stripped = stripXmlTags(aid);
    if (stripped.includes('10.')) {
      return stripped;
    }
  }
  return undefined;
}

/** Parse a single PubmedArticle XML block into structured data. */
function parseArticleXml(articleXml: string): {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  publicationDate: string;
  doi?: string;
  meshTerms: string[];
  publicationType: string[];
} {
  const medlineCitation = extractXmlText(articleXml, 'MedlineCitation');
  const article = extractXmlText(medlineCitation, 'Article');

  const pmid = extractXmlText(medlineCitation, 'PMID');
  const title = stripXmlTags(extractXmlText(article, 'ArticleTitle'));

  // Abstract may have multiple AbstractText sections (structured abstracts)
  const abstractSection = extractXmlText(article, 'Abstract');
  const abstractParts = extractAllXmlText(abstractSection, 'AbstractText');
  const abstract = abstractParts.map(stripXmlTags).join('\n\n');

  // Authors
  const authorListXml = extractXmlText(article, 'AuthorList');
  const authorBlocks = extractAllXmlText(authorListXml, 'Author');
  const authors = authorBlocks.map((authorXml) => {
    const lastName = extractXmlText(authorXml, 'LastName');
    const foreName = extractXmlText(authorXml, 'ForeName');
    const collectiveName = extractXmlText(authorXml, 'CollectiveName');
    if (lastName && foreName) return `${lastName} ${foreName}`;
    if (lastName) return lastName;
    return collectiveName || 'Unknown';
  });

  // Journal
  const journalXml = extractXmlText(article, 'Journal');
  const journal =
    extractXmlText(journalXml, 'Title') || extractXmlText(journalXml, 'ISOAbbreviation');

  // Publication date
  const pubDateXml = extractXmlText(journalXml, 'PubDate');
  const year = extractXmlText(pubDateXml, 'Year');
  const month = extractXmlText(pubDateXml, 'Month');
  const day = extractXmlText(pubDateXml, 'Day');
  const medlineDate = extractXmlText(pubDateXml, 'MedlineDate');
  let publicationDate = medlineDate || year;
  if (year && month) publicationDate = day ? `${year}-${month}-${day}` : `${year}-${month}`;

  // DOI from ELocationID or ArticleIdList
  const doi = extractDoi(articleXml, article);

  // MeSH terms
  const meshListXml = extractXmlText(medlineCitation, 'MeshHeadingList');
  const meshHeadings = extractAllXmlText(meshListXml, 'MeshHeading');
  const meshTerms = meshHeadings
    .map((h) => stripXmlTags(extractXmlText(h, 'DescriptorName')))
    .filter(Boolean);

  // Publication types
  const pubTypeListXml = extractXmlText(article, 'PublicationTypeList');
  const publicationType = extractAllXmlText(pubTypeListXml, 'PublicationType')
    .map(stripXmlTags)
    .filter(Boolean);

  return {
    pmid,
    title: title || 'Untitled',
    abstract,
    authors,
    journal: journal || 'Unknown',
    publicationDate: publicationDate || 'Unknown',
    ...(doi ? { doi } : {}),
    meshTerms,
    publicationType,
  };
}

/** Fetch full article details (abstract, MeSH, pubtype) via efetch XML endpoint. */
async function fetchArticleDetails(
  ids: string[],
): Promise<Map<string, ReturnType<typeof parseArticleXml>>> {
  const results = new Map<string, ReturnType<typeof parseArticleXml>>();
  if (ids.length === 0) return results;

  // efetch supports up to 200 IDs per request
  const batchSize = 200;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const url = `${NCBI_BASE_URL}/efetch.fcgi?db=pubmed&id=${batch.join(',')}&rettype=xml&retmode=xml`;

    const response = await ncbiFetch(url);
    if (!response.ok) {
      logger.warn('PubMed efetch failed', { status: response.status, batch: batch.length });
      continue;
    }

    const xml = await response.text();

    // Split into individual article blocks
    const articleRegex = /<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g;
    for (const match of xml.matchAll(articleRegex)) {
      const parsed = parseArticleXml(match[0]);
      if (parsed.pmid) {
        results.set(parsed.pmid, parsed);
      }
    }
  }

  return results;
}

// --- Extracted execute mode functions ---

export interface PubMedSearchResult {
  articles: PubMedArticle[];
  totalCount: number;
  query: string;
}

async function lookupSinglePmid(pmid: string): Promise<PubMedSearchResult> {
  logger.info('PubMed PMID lookup', { pmid });
  const details = await fetchArticleDetails([pmid]);
  const article = details.get(pmid);
  if (!article) {
    logger.warn('PMID not found', { pmid });
    return { articles: [], totalCount: 0, query: `PMID:${pmid}` };
  }
  return {
    articles: [
      {
        ...article,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      },
    ],
    totalCount: 1,
    query: `PMID:${pmid}`,
  };
}

async function lookupBatchPmids(pmids: string[]): Promise<PubMedSearchResult> {
  logger.info('PubMed batch PMID lookup', { count: pmids.length });
  const details = await fetchArticleDetails(pmids);
  const articles: PubMedArticle[] = [];
  for (const id of pmids) {
    const article = details.get(id);
    if (article) {
      articles.push({
        ...article,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      });
    }
  }
  return {
    articles,
    totalCount: articles.length,
    query: `PMIDs:${pmids.join(',')}`,
  };
}

async function lookupCitedBy(citedByPmid: string, maxResults: number): Promise<PubMedSearchResult> {
  logger.info('PubMed citedBy lookup', { citedByPmid });
  const linkUrl = `${NCBI_BASE_URL}/elink.fcgi?dbfrom=pubmed&db=pubmed&id=${citedByPmid}&linkname=pubmed_pubmed_citedin&retmode=json`;
  const linkResponse = await ncbiFetch(linkUrl);

  if (!linkResponse.ok) {
    logger.error('PubMed elink failed', { status: linkResponse.status });
    return { articles: [], totalCount: 0, query: `citedBy:${citedByPmid}` };
  }

  const linkData = eLinkResultSchema.safeParse(await linkResponse.json());
  if (!linkData.success) {
    logger.warn('PubMed elink parse failed', { citedByPmid });
    return { articles: [], totalCount: 0, query: `citedBy:${citedByPmid}` };
  }

  const linksets = linkData.data.linksets ?? [];
  const citingIds: string[] = [];
  for (const ls of linksets) {
    for (const db of ls.linksetdbs ?? []) {
      if (db.links) citingIds.push(...db.links);
    }
  }

  const totalCiting = citingIds.length;
  const idsToFetch = citingIds.slice(0, maxResults);

  if (idsToFetch.length === 0) {
    return { articles: [], totalCount: 0, query: `citedBy:${citedByPmid}` };
  }

  const details = await fetchArticleDetails(idsToFetch);
  const articles: PubMedArticle[] = [];
  for (const id of idsToFetch) {
    const article = details.get(id);
    if (article) {
      articles.push({
        ...article,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      });
    }
  }

  logger.info('PubMed citedBy complete', { citedByPmid, citingCount: totalCiting });
  return { articles, totalCount: totalCiting, query: `citedBy:${citedByPmid}` };
}

/** Fill in missing article details from esummary when efetch didn't return them. */
async function fillMissingFromSummary(
  ids: string[],
  details: Map<string, ReturnType<typeof parseArticleXml>>,
): Promise<void> {
  const missingIds = ids.filter((id) => !details.has(id));
  if (missingIds.length === 0) return;

  const summaryUrl = `${NCBI_BASE_URL}/esummary.fcgi?db=pubmed&id=${missingIds.join(',')}&retmode=json`;
  const summaryResponse = await ncbiFetch(summaryUrl);
  if (!summaryResponse.ok) return;

  const summaryData = eSummaryResultSchema.parse(await summaryResponse.json());
  for (const id of missingIds) {
    const raw = summaryData.result[id];
    if (!raw || typeof raw !== 'object') continue;

    const parsed = eSummaryArticleSchema.safeParse(raw);
    if (!parsed.success) continue;

    const article = parsed.data;
    details.set(id, {
      pmid: id,
      title: article.title ?? 'Untitled',
      abstract: '',
      authors: article.authors?.map((a) => a.name ?? 'Unknown') ?? [],
      journal: article.source ?? 'Unknown',
      publicationDate: article.pubdate ?? 'Unknown',
      ...(article.elocationid ? { doi: article.elocationid } : {}),
      meshTerms: [],
      publicationType: [],
    });
  }
}

async function searchByKeyword(query: string, maxResults: number): Promise<PubMedSearchResult> {
  logger.info('Searching PubMed', { query, maxResults });

  const searchUrl = `${NCBI_BASE_URL}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json`;

  const searchResponse = await ncbiFetch(searchUrl);
  if (!searchResponse.ok) {
    logger.error('PubMed search failed', { status: searchResponse.status });
    return { articles: [], totalCount: 0, query };
  }

  const searchData = eSearchResultSchema.parse(await searchResponse.json());
  const ids = searchData.esearchresult.idlist;
  const totalCount = Number.parseInt(searchData.esearchresult.count, 10);

  if (ids.length === 0) {
    logger.info('No PubMed results found', { query });
    return { articles: [], totalCount: 0, query };
  }

  // Use efetch for full details (abstracts, MeSH, publication types)
  const details = await fetchArticleDetails(ids);

  // Fall back to esummary for articles that efetch didn't return
  await fillMissingFromSummary(ids, details);

  const articles: PubMedArticle[] = ids.reduce<PubMedArticle[]>((acc, id) => {
    const article = details.get(id);
    if (!article) return acc;

    acc.push({
      ...article,
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
    });
    return acc;
  }, []);

  logger.info('PubMed search complete', { query, resultCount: articles.length, totalCount });
  return { articles, totalCount, query };
}

export const pubmedSearchTool = createTool({
  id: 'pubmed-search',
  description:
    'Search PubMed for medical research articles. Supports three modes: (1) keyword search with full abstracts, (2) PMID lookup to verify a specific article exists and get its details, (3) citedBy to find articles citing a given PMID. Returns abstracts, MeSH terms, and publication types.',
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe('Search query — use MeSH terms when possible for better results'),
    pmid: z
      .string()
      .optional()
      .describe('Specific PMID to look up (verify existence and get full details)'),
    pmids: z.array(z.string()).optional().describe('Multiple PMIDs to look up in batch'),
    citedByPmid: z.string().optional().describe('Find articles that cite this PMID'),
    maxResults: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of results to return (default: 10)'),
  }),
  outputSchema: z.object({
    articles: z.array(PubMedArticleSchema).describe('List of matching PubMed articles'),
    totalCount: z.number().describe('Total number of matching articles in PubMed'),
    query: z.string().describe('The query that was executed'),
  }),
  execute: async (inputData) => {
    const { query, pmid, pmids, citedByPmid, maxResults = 10 } = inputData;

    if (pmid) return lookupSinglePmid(pmid);
    if (pmids && pmids.length > 0) return lookupBatchPmids(pmids);
    if (citedByPmid) return lookupCitedBy(citedByPmid, maxResults);
    if (!query) return { articles: [], totalCount: 0, query: '' };
    return searchByKeyword(query, maxResults);
  },
});
