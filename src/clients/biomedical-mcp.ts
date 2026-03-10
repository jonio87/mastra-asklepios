import type { Tool } from '@mastra/core/tools';
import { MCPClient } from '@mastra/mcp';

import { logger } from '../utils/logger.js';

/**
 * Biomedical MCP client — connects to 8 community-maintained MCP servers
 * providing access to 50+ databases and 80+ tools.
 *
 * Servers:
 * - BioMCP: PubMed, ClinVar, gnomAD, OncoKB, PharmGKB, DGIdb, GTEx, etc.
 * - gget: Ensembl, BLAST, enrichment analysis
 * - BioThings: MyGene.info (22M genes), MyVariant.info (400M variants)
 * - Pharmacology: Guide to PHARMACOLOGY (targets, ligands, interactions)
 * - OpenGenes: aging/longevity gene database (SQL-queryable)
 * - SynergyAge: synergistic gene interactions (SQL-queryable)
 * - BioContextAI: STRING, Reactome, UniProt, KEGG, DisGeNET, HPO (18+ DBs)
 * - Open Targets: gene-disease association scoring, drug targets
 *
 * Uses @mastra/mcp MCPClient which auto-namespaces tools as `serverName_toolName`
 * and gracefully skips servers that fail to connect.
 */

const ncbiEnv: Record<string, string> = {};
const ncbiKey = process.env['NCBI_API_KEY'];
if (ncbiKey) {
  ncbiEnv['NCBI_API_KEY'] = ncbiKey;
}

export const biomedicalMcp = new MCPClient({
  id: 'asklepios-biomedical',
  servers: {
    biomcp: {
      command: 'uvx',
      args: ['biomcp-cli', 'run'],
      env: ncbiEnv,
      timeout: 30_000,
    },
    gget: {
      command: 'uvx',
      args: ['gget-mcp'],
      timeout: 30_000,
    },
    biothings: {
      command: 'uvx',
      args: ['biothings-mcp'],
      timeout: 30_000,
    },
    pharmacology: {
      command: 'uvx',
      args: ['pharmacology-mcp'],
      timeout: 30_000,
    },
    opengenes: {
      command: 'uvx',
      args: ['opengenes-mcp'],
      timeout: 30_000,
    },
    synergyage: {
      command: 'uvx',
      args: ['synergy-age-mcp'],
      timeout: 30_000,
    },
    biocontext: {
      command: 'uvx',
      args: ['biocontext_kb'],
      timeout: 30_000,
    },
    opentargets: {
      command: 'npx',
      args: ['-y', 'opentargets-mcp'],
      timeout: 30_000,
    },
  },
  timeout: 60_000,
});

/** Cached tools to avoid reconnecting on every call */
let cachedTools: Record<string, Tool> | undefined;

/**
 * Get all biomedical MCP tools, namespaced by server.
 * Results are cached after first successful call.
 *
 * Tool names follow the pattern `serverName_toolName`, e.g.:
 * - `biomcp_article_searcher`
 * - `gget_gget_enrichr`
 * - `biothings_query_mygene`
 * - `opentargets_search`
 *
 * Servers that fail to connect are silently skipped (MCPClient built-in behavior).
 */
export async function getBiomedicalTools(): Promise<Record<string, Tool>> {
  if (cachedTools) return cachedTools;

  logger.info('Connecting to biomedical MCP servers...');
  const start = Date.now();

  try {
    cachedTools = await biomedicalMcp.listTools();
    const toolCount = Object.keys(cachedTools).length;
    const durationMs = Date.now() - start;
    logger.info('Biomedical MCP tools loaded', { toolCount, durationMs });
    return cachedTools;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error('Failed to load biomedical MCP tools', { error });
    return {};
  }
}

/**
 * Get biomedical tools grouped by server name.
 * Useful for selective tool injection (e.g., only BioMCP tools for a specific agent).
 */
export async function getBiomedicalToolsets(): Promise<Record<string, Record<string, Tool>>> {
  try {
    return await biomedicalMcp.listToolsets();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error('Failed to load biomedical MCP toolsets', { error });
    return {};
  }
}

/**
 * Invalidate the tool cache (e.g., after reconnection or config change).
 */
export function clearBiomedicalToolCache(): void {
  cachedTools = undefined;
}

/**
 * Disconnect all biomedical MCP servers. Call on process exit.
 */
export async function disconnectBiomedicalMcp(): Promise<void> {
  cachedTools = undefined;
  await biomedicalMcp.disconnect();
  logger.info('Biomedical MCP servers disconnected');
}
