import { describe, expect, it, jest } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Tests for the biomedical MCP bridge.
 *
 * Validates that upstream biomedical MCP tools are correctly proxied
 * through the Asklepios MCP server with proper namespacing.
 */

// Mock the biomedical MCP client
const mockTool = {
  id: 'biomcp_article_searcher',
  description: 'Search PubMed articles via BioMCP',
  inputSchema: { parse: jest.fn(), safeParse: jest.fn() },
  execute: jest.fn(() => Promise.resolve({ articles: [{ title: 'Test Article' }] })),
};

const mockGeneTool = {
  id: 'gget_gget_enrichr',
  description: 'Gene set enrichment via gget',
  inputSchema: { parse: jest.fn(), safeParse: jest.fn() },
  execute: jest.fn(() => Promise.resolve({ results: [] })),
};

jest.mock('../clients/biomedical-mcp.js', () => ({
  getBiomedicalTools: jest.fn(() =>
    Promise.resolve({
      biomcp_article_searcher: mockTool,
      gget_gget_enrichr: mockGeneTool,
    }),
  ),
  biomedicalMcp: {
    listTools: jest.fn(() =>
      Promise.resolve({
        biomcp_article_searcher: mockTool,
        gget_gget_enrichr: mockGeneTool,
      }),
    ),
  },
}));

jest.mock('../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

/**
 * Helper to access private McpServer internals for testing.
 */
function getServerInternals(server: McpServer) {
  const raw = server as unknown as Record<string, Record<string, unknown>>;
  return {
    tools: raw['_registeredTools'] ?? {},
  };
}

function createTestServer(): McpServer {
  return new McpServer(
    { name: 'biomedical-test', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
}

describe('registerBiomedicalTools', () => {
  it('registers proxied tools from upstream MCP servers', async () => {
    const { registerBiomedicalTools } = await import('./tools-biomedical.js');
    const server = createTestServer();

    await registerBiomedicalTools(server);

    const { tools } = getServerInternals(server);
    const toolNames = Object.keys(tools);

    expect(toolNames.length).toBe(2);
    expect(toolNames).toContain('bio_biomcp_article_searcher');
    expect(toolNames).toContain('bio_gget_gget_enrichr');
  });

  it('prefixes tool names with bio_ to avoid collisions', async () => {
    const { registerBiomedicalTools } = await import('./tools-biomedical.js');
    const server = createTestServer();

    await registerBiomedicalTools(server);

    const { tools } = getServerInternals(server);
    const toolNames = Object.keys(tools);

    for (const name of toolNames) {
      expect(name.startsWith('bio_')).toBe(true);
    }
  });

  it('handles empty tool list gracefully', async () => {
    // Override mock for this test
    const bioMod = await import('../clients/biomedical-mcp.js');
    (bioMod.getBiomedicalTools as ReturnType<typeof jest.fn>).mockResolvedValueOnce({});

    const { registerBiomedicalTools } = await import('./tools-biomedical.js');
    const server = createTestServer();

    await registerBiomedicalTools(server);

    const { tools } = getServerInternals(server);
    expect(Object.keys(tools).length).toBe(0);
  });

  it('preserves tool descriptions in proxy', async () => {
    const { registerBiomedicalTools } = await import('./tools-biomedical.js');
    const server = createTestServer();

    await registerBiomedicalTools(server);

    const { tools } = getServerInternals(server);
    const tool = tools['bio_biomcp_article_searcher'] as Record<string, unknown> | undefined;
    expect(tool).toBeDefined();
    expect(tool?.['description']).toBe('Search PubMed articles via BioMCP');
  });
});
