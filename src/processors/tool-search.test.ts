/**
 * Tests for the ToolSearchProcessor configuration.
 *
 * Note: The ToolSearchProcessor import from @mastra/core/processors
 * triggers an ESM/CJS compatibility issue with execa in the Jest
 * environment. These tests use source file analysis to validate
 * configuration where possible.
 *
 * Full integration testing of BM25 search and tool loading is
 * verified via manual testing with the running agent.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/processors/tool-search.ts'), 'utf-8');
}

describe('clinicalToolSearch processor', () => {
  const nativeTools = [
    'deepResearch',
    'hpoMapper',
    'documentParser',
    'ingestDocument',
    'knowledgeQuery',
  ];

  it('source exports clinicalToolSearch with ToolSearchProcessor', () => {
    const content = readSource();
    expect(content).toContain('ToolSearchProcessor');
    expect(content).toContain('clinicalToolSearch');
  });

  it('configures 5 Asklepios-native tools for lazy loading', () => {
    const content = readSource();
    for (const tool of nativeTools) {
      expect(content).toContain(tool);
    }
  });

  it('spreads biomedical MCP tools into the tool pool', () => {
    const content = readSource();
    expect(content).toContain('getBiomedicalTools');
    expect(content).toContain('...biomedicalTools');
  });

  it('does not include deleted hand-built biomedical tools', () => {
    const content = readSource();
    // These tools were deleted — replaced by MCP servers
    const deletedTools = ['pubmedSearch', 'orphanetLookup', 'clinvarLookup'];
    for (const tool of deletedTools) {
      const toolKeyPattern = new RegExp(`^\\s+${tool}:`, 'm');
      expect(toolKeyPattern.test(content)).toBe(false);
    }
  });

  it('configures search with topK=5 and minScore=0.1', () => {
    const content = readSource();
    expect(content).toContain('topK: 5');
    expect(content).toContain('minScore: 0.1');
  });

  it('configures TTL of 1 hour', () => {
    const content = readSource();
    expect(content).toContain('3_600_000');
  });

  it('does not include always-loaded tools', () => {
    const content = readSource();
    const alwaysLoadedTools = ['captureData', 'queryData', 'brainRecall', 'brainFeed'];
    for (const tool of alwaysLoadedTools) {
      const toolKeyPattern = new RegExp(`^\\s+${tool}:`, 'm');
      expect(toolKeyPattern.test(content)).toBe(false);
    }
  });

  it('imports from correct module paths', () => {
    const content = readSource();
    expect(content).toContain("from '@mastra/core/processors'");
    expect(content).toContain("from '../clients/biomedical-mcp.js'");
    expect(content).toContain("from '../tools/deep-research.js'");
    expect(content).toContain("from '../tools/hpo-mapper.js'");
    expect(content).toContain("from '../tools/document-parser.js'");
    expect(content).toContain("from '../tools/ingest-document.js'");
    expect(content).toContain("from '../tools/knowledge-query.js'");
  });
});
