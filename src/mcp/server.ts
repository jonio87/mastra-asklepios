import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerAgentTools } from './tools-agents.js';
import { registerClinicalTools } from './tools-clinical.js';
import { registerCoreTools } from './tools-core.js';
import { registerSessionTools } from './tools-session.js';
import { registerStateTools } from './tools-state.js';
import { registerStreamingTools } from './tools-streaming.js';
import { registerTaskTools } from './tools-tasks.js';
import { registerWorkflowTools } from './tools-workflows.js';

/**
 * Asklepios MCP Server — agent-native control plane.
 *
 * Exposes the full Asklepios system as MCP primitives:
 *   - 29 tools (6 core + 4 agents + 3 workflows + 5 state + 2 task + 4 clinical + 3 session + 2 streaming)
 *   - 7 resources (patient data, system health, agent configs — subscribable)
 *   - 4 prompts (diagnostic workflows, case review, testing scenarios)
 *
 * Any MCP client (Claude Desktop, Cursor, Claude Code, custom QA agent)
 * can connect and programmatically test every capability.
 */
export function createAsklepiosMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'asklepios',
      version: '0.4.0',
    },
    {
      capabilities: {
        resources: { subscribe: true, listChanged: true },
        tools: {},
        prompts: {},
        logging: {},
      },
      instructions:
        'Asklepios is an AI-powered rare disease research assistant with diagnostic reasoning, multi-agent orchestration, and cross-patient pattern matching. Use capture_clinical_data and query_clinical_data for structured clinical records, ingest_document and search_knowledge for document knowledge base, and stream_asklepios for interactive chat.',
    },
  );

  registerCoreTools(server);
  registerAgentTools(server);
  registerWorkflowTools(server);
  registerStateTools(server);
  registerTaskTools(server);
  registerClinicalTools(server);
  registerSessionTools(server);
  registerStreamingTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}
