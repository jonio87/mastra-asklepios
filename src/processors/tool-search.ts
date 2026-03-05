import { ToolSearchProcessor } from '@mastra/core/processors';
import { clinvarLookupTool } from '../tools/clinvar-lookup.js';
import { deepResearchTool } from '../tools/deep-research.js';
import { documentParserTool } from '../tools/document-parser.js';
import { hpoMapperTool } from '../tools/hpo-mapper.js';
import { ingestDocumentTool } from '../tools/ingest-document.js';
import { knowledgeQueryTool } from '../tools/knowledge-query.js';
import { orphanetLookupTool } from '../tools/orphanet-lookup.js';
import { pubmedSearchTool } from '../tools/pubmed-search.js';

/**
 * Lazy-loads non-essential tools via BM25 search.
 *
 * These tools are NOT included in every agent call. Instead, the agent gets
 * two meta-tools (search_tools, load_tool) and discovers them on demand.
 *
 * Always-loaded tools (captureData, queryData, brainRecall, brainFeed) stay
 * in the agent's static tools — they're needed on every conversation turn.
 *
 * Estimated savings: ~5K tokens per call (8 tool schemas removed from context).
 */
export const clinicalToolSearch = new ToolSearchProcessor({
  tools: {
    pubmedSearch: pubmedSearchTool,
    orphanetLookup: orphanetLookupTool,
    clinvarLookup: clinvarLookupTool,
    deepResearch: deepResearchTool,
    hpoMapper: hpoMapperTool,
    documentParser: documentParserTool,
    ingestDocument: ingestDocumentTool,
    knowledgeQuery: knowledgeQueryTool,
  },
  search: {
    topK: 3,
    minScore: 0.1,
  },
  ttl: 3_600_000, // 1 hour
});
