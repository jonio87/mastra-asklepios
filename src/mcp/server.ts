import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerAgentTools } from './tools-agents.js';
import { registerCoreTools } from './tools-core.js';
import { registerStateTools } from './tools-state.js';
import { registerWorkflowTools } from './tools-workflows.js';

/**
 * Asklepios MCP Server — AI-testable control plane.
 *
 * Exposes the full Asklepios system as MCP primitives:
 *   - 17 tools (core, agents, workflows, state inspection, raw tool access)
 *   - 7 resources (patient data, system health, agent configs)
 *   - 4 prompts (diagnostic workflows, case review, testing scenarios)
 *
 * Any MCP client (Claude Desktop, Cursor, Claude Code, custom QA agent)
 * can connect and programmatically test every capability.
 */
export function createAsklepiosMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'asklepios',
      version: '0.2.0',
    },
    {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {},
      },
    },
  );

  registerCoreTools(server);
  registerAgentTools(server);
  registerWorkflowTools(server);
  registerStateTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}
