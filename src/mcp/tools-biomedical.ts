import type { Tool } from '@mastra/core/tools';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';

import { getBiomedicalTools } from '../clients/biomedical-mcp.js';
import { logger } from '../utils/logger.js';

/**
 * Biomedical MCP bridge — proxies 80+ tools from 8 upstream MCP servers
 * through the Asklepios MCP server.
 *
 * This enables Claude Code (or any MCP client) to access all biomedical
 * databases via a single Asklepios MCP endpoint instead of configuring
 * 8 separate MCP server connections.
 *
 * Upstream servers: BioMCP, gget, BioThings, Pharmacology, OpenGenes,
 * SynergyAge, BioContextAI, Open Targets
 */
export async function registerBiomedicalTools(server: McpServer): Promise<number> {
  const tools = await getBiomedicalTools();
  const toolEntries = Object.entries(tools);

  if (toolEntries.length === 0) {
    logger.warn('No biomedical MCP tools available to register');
    return 0;
  }

  let registered = 0;

  for (const [name, tool] of toolEntries) {
    registerProxiedTool(server, name, tool);
    registered++;
  }

  logger.info('Biomedical MCP tools registered', { count: registered });
  return registered;
}

function registerProxiedTool(server: McpServer, name: string, tool: Tool): void {
  const prefixedName = `bio_${name}`;
  const description = tool.description || `Biomedical tool: ${name}`;

  if (tool.inputSchema) {
    server.registerTool(
      prefixedName,
      {
        description,
        // MCPClient converts JSON Schema to Zod schemas at runtime.
        // Cast needed: Mastra's SchemaWithValidation is structural, MCP SDK's AnySchema is nominal.
        inputSchema: tool.inputSchema as AnySchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
        },
      },
      async (args: unknown) => {
        return executeProxiedTool(tool, name, args);
      },
    );
  } else {
    // Tool with no input schema — register without inputSchema
    server.registerTool(
      prefixedName,
      {
        description,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
        },
      },
      async () => {
        return executeProxiedTool(tool, name, {});
      },
    );
  }
}

async function executeProxiedTool(
  tool: Tool,
  name: string,
  args: unknown,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  if (!tool.execute) {
    return {
      content: [{ type: 'text' as const, text: `Tool ${name} has no execute function` }],
      isError: true,
    };
  }

  try {
    const result = await tool.execute(args, {});
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

    return {
      content: [{ type: 'text' as const, text }],
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error('Biomedical tool execution failed', { tool: name, error });

    return {
      content: [{ type: 'text' as const, text: `Error executing ${name}: ${error}` }],
      isError: true,
    };
  }
}
