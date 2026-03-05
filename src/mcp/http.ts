/**
 * MCP Streamable HTTP entry point.
 *
 * Serves the Asklepios MCP server over HTTP at POST/GET/DELETE /mcp.
 * Alongside the existing stdio transport, this enables remote agent connections.
 *
 * Usage: node --env-file=.env dist/mcp/http.js
 */

import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createAsklepiosMcpServer } from './server.js';

const PORT = Number(process.env['MCP_PORT'] ?? 4112);

const server = createAsklepiosMcpServer();

// Stateful transport — each session gets a UUID
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});

// eslint-disable-next-line -- SDK transport type has optional props that are set internally
await server.connect(transport as Parameters<typeof server.connect>[0]);

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // CORS headers for cross-origin agent access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', server: 'asklepios-mcp', version: '0.4.0' }));
    return;
  }

  // MCP endpoint
  if (url.pathname === '/mcp') {
    await transport.handleRequest(req, res);
    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', endpoints: ['/mcp', '/health'] }));
});

httpServer.listen(PORT, () => {
  process.stderr.write(
    `Asklepios MCP HTTP server listening on http://localhost:${PORT}\n` +
      `  MCP endpoint: POST/GET/DELETE http://localhost:${PORT}/mcp\n` +
      `  Health check: GET http://localhost:${PORT}/health\n`,
  );
});

// Graceful shutdown
function shutdown() {
  process.stderr.write('Shutting down MCP HTTP server...\n');
  httpServer.close();
  transport.close().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
