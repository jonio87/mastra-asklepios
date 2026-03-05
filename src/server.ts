/**
 * Unified server entry point — starts both MCP and A2A servers.
 *
 * MCP Streamable HTTP: http://localhost:4112/mcp
 * A2A JSON-RPC:        http://localhost:4113/a2a
 * A2A Agent Card:      http://localhost:4113/.well-known/agent-card.json
 *
 * Usage: node --env-file=.env dist/server.js
 */

import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createA2aServer } from './a2a/server.js';
import { createAsklepiosMcpServer } from './mcp/server.js';

const MCP_PORT = Number(process.env['MCP_PORT'] ?? 4112);
const A2A_PORT = Number(process.env['A2A_PORT'] ?? 4113);

// ─── MCP HTTP Server ──────────────────────────────────────────────────────────

const mcpServer = createAsklepiosMcpServer();
const mcpTransport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});

await mcpServer.connect(mcpTransport as Parameters<typeof mcpServer.connect>[0]);

const mcpHttpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${MCP_PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', server: 'asklepios-mcp', version: '0.4.0' }));
    return;
  }

  if (url.pathname === '/mcp') {
    await mcpTransport.handleRequest(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', endpoints: ['/mcp', '/health'] }));
});

// ─── A2A Server ───────────────────────────────────────────────────────────────

const a2aApp = createA2aServer(A2A_PORT);

// ─── Start Both ───────────────────────────────────────────────────────────────

mcpHttpServer.listen(MCP_PORT, () => {
  process.stderr.write(
    `\n┌──────────────────────────────────────────────────┐\n` +
      `│  Asklepios Agent Service                         │\n` +
      `├──────────────────────────────────────────────────┤\n` +
      `│  MCP HTTP  → http://localhost:${MCP_PORT}/mcp${' '.repeat(17 - String(MCP_PORT).length)}│\n` +
      `│  A2A       → http://localhost:${A2A_PORT}/a2a${' '.repeat(17 - String(A2A_PORT).length)}│\n` +
      `│  AgentCard → http://localhost:${A2A_PORT}/.well-known/agent-card.json │\n` +
      `│  Health    → :${MCP_PORT}/health, :${A2A_PORT}/health${' '.repeat(18 - String(MCP_PORT).length - String(A2A_PORT).length)}│\n` +
      `└──────────────────────────────────────────────────┘\n\n`,
  );
});

a2aApp.listen(A2A_PORT);

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

function shutdown() {
  process.stderr.write('Shutting down Asklepios servers...\n');
  mcpHttpServer.close();
  mcpTransport.close().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
