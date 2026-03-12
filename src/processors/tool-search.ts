import { ToolSearchProcessor } from '@mastra/core/processors';
import { getBiomedicalTools } from '../clients/biomedical-mcp.js';
import { deepResearchTool } from '../tools/deep-research.js';
import { documentParserTool } from '../tools/document-parser.js';
import { hpoMapperTool } from '../tools/hpo-mapper.js';
import { ingestDocumentTool } from '../tools/ingest-document.js';
import { knowledgeQueryTool } from '../tools/knowledge-query.js';

/**
 * Lazy-loads tools via BM25 search — both Asklepios-native and MCP tools.
 *
 * These tools are NOT included in every agent call. Instead, the agent gets
 * two meta-tools (search_tools, load_tool) and discovers them on demand.
 *
 * Always-loaded tools (captureData, queryData, brainRecall, brainFeed) stay
 * in the agent's static tools — they're needed on every conversation turn.
 *
 * MCP tools (80+ from 8 biomedical servers) are loaded at module init
 * and merged into the BM25 search pool alongside Asklepios-native tools.
 * Servers that fail to connect are silently skipped.
 */
const biomedicalTools = await getBiomedicalTools();

export const clinicalToolSearch = new ToolSearchProcessor({
  tools: {
    // Asklepios-native tools (no MCP equivalent)
    deepResearch: deepResearchTool,
    hpoMapper: hpoMapperTool,
    documentParser: documentParserTool,
    ingestDocument: ingestDocumentTool,
    knowledgeQuery: knowledgeQueryTool,
    // 80+ biomedical MCP tools (biomcp_*, gget_*, biothings_*, etc.)
    ...biomedicalTools,
  },
  search: {
    topK: 5,
    minScore: 0.1,
  },
  ttl: 3_600_000, // 1 hour
});
