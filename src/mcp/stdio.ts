#!/usr/bin/env node

/**
 * Asklepios MCP Server — Stdio Transport
 *
 * Entry point for MCP clients that use stdio transport (Claude Desktop, Cursor, etc.)
 *
 * Usage in Claude Desktop config (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "asklepios": {
 *       "command": "node",
 *       "args": ["<path-to-project>/dist/mcp/stdio.js"]
 *     }
 *   }
 * }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createAsklepiosMcpServer } from './server.js';

async function main(): Promise<void> {
  const server = createAsklepiosMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Asklepios MCP server error: ${message}\n`);
  process.exit(1);
});
