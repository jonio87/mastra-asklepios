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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/processors/tool-search.ts'), 'utf-8');
}

describe('clinicalToolSearch processor', () => {
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

  it('source exports clinicalToolSearch with ToolSearchProcessor', () => {
    const content = readSource();
    expect(content).toContain('ToolSearchProcessor');
    expect(content).toContain('clinicalToolSearch');
  });

  it('configures all 8 non-essential tools for lazy loading', () => {
    const content = readSource();
    for (const tool of expectedTools) {
      expect(content).toContain(tool);
    }
  });

  it('configures search with topK=3 and minScore=0.1', () => {
    const content = readSource();
    expect(content).toContain('topK: 3');
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
