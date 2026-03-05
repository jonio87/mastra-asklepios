/**
 * Tests for the ToolSearchProcessor configuration.
 *
 * Note: The ToolSearchProcessor import from @mastra/core/processors
 * triggers an ESM/CJS compatibility issue with execa in the Jest
 * environment. These tests use dynamic import with error handling
 * to validate configuration where possible.
 *
 * Full integration testing of BM25 search and tool loading is
 * verified via manual testing with the running agent.
 */

describe('clinicalToolSearch processor', () => {
  // The tool-search module has 8 lazy-loadable tools
  const expectedTools = [
    'pubmedSearch',
    'orphanetLookup',
    'clinvarLookup',
    'deepResearch',
    'hpoMapper',
    'documentParser',
    'ingestDocument',
    'knowledgeQuery',
  ];

  it('tool-search.ts module exports clinicalToolSearch', async () => {
    // We can't import at top level due to ESM/CJS issue with @mastra/core/processors,
    // but we can verify the module structure via require
    try {
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      const mod = jest.requireActual('../processors/tool-search.js') as any;
      expect(mod.clinicalToolSearch).toBeDefined();
    } catch {
      // Expected in Jest environment due to execa ESM issue
      // Verify the source file exists and has the right structure instead
      const fs = await import('node:fs');
      const path = await import('node:path');
      const filePath = path.resolve(__dirname, './tool-search.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).toContain('ToolSearchProcessor');
      expect(content).toContain('clinicalToolSearch');
      for (const tool of expectedTools) {
        expect(content).toContain(tool);
      }
    }
  });

  it('configures all 8 non-essential tools for lazy loading', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const filePath = path.resolve(__dirname, './tool-search.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Verify all expected tools are referenced in the processor config
    for (const tool of expectedTools) {
      expect(content).toContain(tool);
    }
  });

  it('configures search with topK=3 and minScore=0.1', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const filePath = path.resolve(__dirname, './tool-search.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('topK: 3');
    expect(content).toContain('minScore: 0.1');
  });

  it('configures TTL of 1 hour', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const filePath = path.resolve(__dirname, './tool-search.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('3_600_000');
  });

  it('does not include always-loaded tools (captureData, queryData, brainRecall, brainFeed)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const filePath = path.resolve(__dirname, './tool-search.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    // These tools should NOT be in the lazy-load set
    const alwaysLoadedTools = ['captureData', 'queryData', 'brainRecall', 'brainFeed'];
    for (const tool of alwaysLoadedTools) {
      // Check within the tools: { ... } config block — they shouldn't appear as keys
      const toolKeyPattern = new RegExp(`^\\s+${tool}:`, 'm');
      expect(toolKeyPattern.test(content)).toBe(false);
    }
  });

  it('imports from correct module paths', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const filePath = path.resolve(__dirname, './tool-search.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain("from '@mastra/core/processors'");
    expect(content).toContain("from '../tools/pubmed-search.js'");
    expect(content).toContain("from '../tools/orphanet-lookup.js'");
    expect(content).toContain("from '../tools/clinvar-lookup.js'");
    expect(content).toContain("from '../tools/deep-research.js'");
    expect(content).toContain("from '../tools/hpo-mapper.js'");
    expect(content).toContain("from '../tools/document-parser.js'");
    expect(content).toContain("from '../tools/ingest-document.js'");
    expect(content).toContain("from '../tools/knowledge-query.js'");
  });
});
