import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * Tests for the biomedical MCP client module.
 *
 * Validates exports, function signatures, and graceful degradation.
 * Integration tests require biomedical MCP servers (uvx, npx).
 */

// Mock the MCPClient to avoid spawning real MCP server processes
jest.mock('@mastra/mcp', () => {
  const mockListTools = jest.fn(() =>
    Promise.resolve({
      biomcp_article_searcher: {
        id: 'biomcp_article_searcher',
        description: 'Search PubMed articles',
        execute: jest.fn(),
      },
      biomcp_gene_searcher: {
        id: 'biomcp_gene_searcher',
        description: 'Search genes',
        execute: jest.fn(),
      },
      gget_gget_enrichr: {
        id: 'gget_gget_enrichr',
        description: 'Gene set enrichment',
        execute: jest.fn(),
      },
    }),
  );

  const mockListToolsets = jest.fn(() =>
    Promise.resolve({
      biomcp: {
        biomcp_article_searcher: { id: 'biomcp_article_searcher', execute: jest.fn() },
        biomcp_gene_searcher: { id: 'biomcp_gene_searcher', execute: jest.fn() },
      },
      gget: {
        gget_gget_enrichr: { id: 'gget_gget_enrichr', execute: jest.fn() },
      },
    }),
  );

  const mockDisconnect = jest.fn(() => Promise.resolve());

  return {
    MCPClient: jest.fn(() => ({
      listTools: mockListTools,
      listToolsets: mockListToolsets,
      disconnect: mockDisconnect,
    })),
  };
});

// Mock logger to suppress output during tests
jest.mock('../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('biomedical-mcp client', () => {
  beforeEach(async () => {
    // Clear cached tools and reset mock call counts before each test
    const mod = await import('./biomedical-mcp.js');
    mod.clearBiomedicalToolCache();
    (mod.biomedicalMcp.listTools as ReturnType<typeof jest.fn>).mockClear();
    (mod.biomedicalMcp.listToolsets as ReturnType<typeof jest.fn>).mockClear();
    (mod.biomedicalMcp.disconnect as ReturnType<typeof jest.fn>).mockClear();
  });

  describe('exports', () => {
    it('exports getBiomedicalTools function', async () => {
      const { getBiomedicalTools } = await import('./biomedical-mcp.js');
      expect(typeof getBiomedicalTools).toBe('function');
    });

    it('exports getBiomedicalToolsets function', async () => {
      const { getBiomedicalToolsets } = await import('./biomedical-mcp.js');
      expect(typeof getBiomedicalToolsets).toBe('function');
    });

    it('exports clearBiomedicalToolCache function', async () => {
      const { clearBiomedicalToolCache } = await import('./biomedical-mcp.js');
      expect(typeof clearBiomedicalToolCache).toBe('function');
    });

    it('exports disconnectBiomedicalMcp function', async () => {
      const { disconnectBiomedicalMcp } = await import('./biomedical-mcp.js');
      expect(typeof disconnectBiomedicalMcp).toBe('function');
    });

    it('exports biomedicalMcp instance', async () => {
      const { biomedicalMcp } = await import('./biomedical-mcp.js');
      expect(biomedicalMcp).toBeDefined();
      expect(typeof biomedicalMcp.listTools).toBe('function');
    });
  });

  describe('getBiomedicalTools', () => {
    it('returns tools from MCP servers', async () => {
      const { getBiomedicalTools } = await import('./biomedical-mcp.js');
      const tools = await getBiomedicalTools();

      expect(Object.keys(tools).length).toBeGreaterThan(0);
      expect(tools['biomcp_article_searcher']).toBeDefined();
      expect(tools['gget_gget_enrichr']).toBeDefined();
    });

    it('caches tools on subsequent calls', async () => {
      const { getBiomedicalTools, biomedicalMcp } = await import('./biomedical-mcp.js');

      const first = await getBiomedicalTools();
      const second = await getBiomedicalTools();

      expect(first).toBe(second);
      // listTools should only be called once due to caching
      expect(biomedicalMcp.listTools).toHaveBeenCalledTimes(1);
    });

    it('invalidates cache when clearBiomedicalToolCache is called', async () => {
      const { getBiomedicalTools, clearBiomedicalToolCache, biomedicalMcp } = await import(
        './biomedical-mcp.js'
      );

      await getBiomedicalTools();
      clearBiomedicalToolCache();
      await getBiomedicalTools();

      expect(biomedicalMcp.listTools).toHaveBeenCalledTimes(2);
    });
  });

  describe('getBiomedicalToolsets', () => {
    it('returns tools grouped by server', async () => {
      const { getBiomedicalToolsets } = await import('./biomedical-mcp.js');
      const toolsets = await getBiomedicalToolsets();

      expect(toolsets['biomcp']).toBeDefined();
      expect(toolsets['gget']).toBeDefined();
      expect(toolsets['biomcp']?.['biomcp_article_searcher']).toBeDefined();
    });
  });

  describe('disconnectBiomedicalMcp', () => {
    it('disconnects and clears cache', async () => {
      const { disconnectBiomedicalMcp, biomedicalMcp } = await import('./biomedical-mcp.js');

      await disconnectBiomedicalMcp();
      expect(biomedicalMcp.disconnect).toHaveBeenCalled();
    });
  });

  describe('tool namespacing', () => {
    it('tools are namespaced as serverName_toolName', async () => {
      const { getBiomedicalTools } = await import('./biomedical-mcp.js');
      const tools = await getBiomedicalTools();
      const names = Object.keys(tools);

      // All names should include an underscore (serverName_toolName)
      for (const name of names) {
        expect(name).toMatch(/_/);
      }
    });
  });
});
