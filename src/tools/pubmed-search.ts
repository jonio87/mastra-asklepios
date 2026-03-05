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
});

export type PubMedArticle = z.infer<typeof PubMedArticleSchema>;

const eSearchResultSchema = z.object({
  esearchresult: z.object({
    idlist: z.array(z.string()),
    count: z.string(),
  }),
});

const eFetchArticleSchema = z.object({
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

const eFetchResultSchema = z.object({
  result: z.record(z.string(), z.unknown()),
});

export const pubmedSearchTool = createTool({
  id: 'pubmed-search',
  description:
    'Search PubMed for medical research articles. Use this to find peer-reviewed studies, case reports, and clinical trials related to symptoms, diseases, or genetic conditions. Especially useful for rare disease research.',
  inputSchema: z.object({
    query: z.string().describe('Search query — use MeSH terms when possible for better results'),
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
    const { query, maxResults = 10 } = inputData;

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

    const summaryUrl = `${NCBI_BASE_URL}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
    const summaryResponse = await ncbiFetch(summaryUrl);

    if (!summaryResponse.ok) {
      logger.error('PubMed summary fetch failed', { status: summaryResponse.status });
      return { articles: [], totalCount, query };
    }

    const summaryData = eFetchResultSchema.parse(await summaryResponse.json());

    const articles: PubMedArticle[] = ids.reduce<PubMedArticle[]>((acc, id) => {
      const raw = summaryData.result[id];
      if (!raw || typeof raw !== 'object') return acc;

      const parsed = eFetchArticleSchema.safeParse(raw);
      if (!parsed.success) return acc;

      const article = parsed.data;
      acc.push({
        pmid: id,
        title: article.title ?? 'Untitled',
        abstract: '',
        authors: article.authors?.map((a) => a.name ?? 'Unknown') ?? [],
        journal: article.source ?? 'Unknown',
        publicationDate: article.pubdate ?? 'Unknown',
        ...(article.elocationid ? { doi: article.elocationid } : {}),
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      });
      return acc;
    }, []);

    logger.info('PubMed search complete', { query, resultCount: articles.length, totalCount });
    return { articles, totalCount, query };
  },
});
