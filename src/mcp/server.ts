import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerAgentTools } from './tools-agents.js';
import { registerBiomedicalTools } from './tools-biomedical.js';
import { registerClinicalTools } from './tools-clinical.js';
import { registerCoreTools } from './tools-core.js';
import { registerDataLayerTools } from './tools-data-layer.js';
import { registerResearchTools } from './tools-research.js';
import { registerSessionTools } from './tools-session.js';
import { registerStateTools } from './tools-state.js';
import { registerStreamingTools } from './tools-streaming.js';
import { registerTaskTools } from './tools-tasks.js';
import { registerValidationTools } from './tools-validation.js';
import { registerWorkflowTools } from './tools-workflows.js';

/**
 * Asklepios MCP Server — agent-native control plane.
 *
 * Exposes the full Asklepios system as MCP primitives:
 *   - 38+ Asklepios-native tools (core, agents, workflows, state, tasks, clinical, research, validation, session, streaming, data-layer)
 *   - 80+ biomedical tools proxied from 8 upstream MCP servers (BioMCP, gget, BioThings, Pharmacology, OpenGenes, SynergyAge, BioContextAI, Open Targets)
 *   - 9 resources (patient data, data completeness, provenance summary, system health, agent configs — subscribable)
 *   - 4 prompts (diagnostic workflows, case review, testing scenarios)
 *
 * Any MCP client (Claude Desktop, Cursor, Claude Code, custom QA agent)
 * can connect and access both Asklepios-native capabilities AND
 * comprehensive biomedical databases via a single endpoint.
 */
export async function createAsklepiosMcpServer(): Promise<McpServer> {
  const server = new McpServer(
    {
      name: 'asklepios',
      version: '0.5.0',
    },
    {
      capabilities: {
        resources: { listChanged: true },
        tools: {},
        prompts: {},
        logging: {},
      },
      instructions:
        'Asklepios is an AI-powered rare disease research assistant with diagnostic reasoning, multi-agent orchestration, cross-patient pattern matching, and access to 50+ biomedical databases. Use capture_clinical_data and query_clinical_data for structured clinical records (Layer 0-5: source-documents, lab-results, consultations, imaging, diagnoses, progressions, report-versions), ingest_document and search_knowledge for document knowledge base, stream_asklepios for interactive chat, and bio_* tools for direct biomedical database access (PubMed, ClinVar, gnomAD, UniProt, Reactome, KEGG, STRING, DisGeNET, GTEx, Open Targets). Data layer tools: extract_imaging_findings (decompose text to structured findings), check_data_completeness (audit all layers), check_regeneration (detect stale reports), process_cascade (propagate changes through layers), query_provenance (trace data lineage via W3C PROV).',
    },
  );

  // Asklepios-native tools
  registerCoreTools(server);
  registerAgentTools(server);
  registerWorkflowTools(server);
  registerStateTools(server);
  registerTaskTools(server);
  registerClinicalTools(server);
  registerResearchTools(server);
  registerValidationTools(server);
  registerSessionTools(server);
  registerStreamingTools(server);
  registerDataLayerTools(server);

  // Biomedical MCP bridge — proxies 80+ tools from upstream MCP servers
  await registerBiomedicalTools(server);

  registerResources(server);
  registerPrompts(server);

  return server;
}
