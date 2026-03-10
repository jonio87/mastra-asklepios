/**
 * Tests for the research agent configuration.
 *
 * Note: research-agent.ts uses top-level await (ESM) for MCP tool loading
 * and imports @mastra/core/agent which chains to execa (ESM-only).
 * Both cause issues in ts-jest (CJS transform). We validate via source
 * file analysis, similar to tool-search.test.ts.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/agents/research-agent.ts'), 'utf-8');
}

describe('researchAgent', () => {
  it('has correct agent id', () => {
    const content = readSource();
    expect(content).toContain("id: 'research-agent'");
  });

  it('has correct agent name', () => {
    const content = readSource();
    expect(content).toContain("name: 'Research Agent'");
  });

  it('has instructions with research strategy', () => {
    const content = readSource();
    expect(content).toContain('Research Strategy');
    expect(content).toContain('MeSH terms');
  });

  it('has instructions emphasizing evidence quality', () => {
    const content = readSource();
    expect(content).toContain('evidence');
    expect(content).toContain('PMIDs');
  });

  it('has instructions clarifying research-only role', () => {
    const content = readSource();
    expect(content).toContain('research tool');
    expect(content).toContain('NOT a diagnostic tool');
  });

  it('has instructions referencing MCP servers', () => {
    const content = readSource();
    expect(content).toContain('MCP servers');
    expect(content).toContain('biomedical');
  });

  it('loads biomedical MCP tools via top-level await', () => {
    const content = readSource();
    expect(content).toContain('getBiomedicalTools');
    expect(content).toContain('await getBiomedicalTools()');
    expect(content).toContain('...biomedicalTools');
  });

  it('includes Asklepios-native research tools', () => {
    const content = readSource();
    expect(content).toContain('deepResearch: deepResearchTool');
    expect(content).toContain('parallelResearch: parallelResearchTool');
  });

  it('imports from correct module paths', () => {
    const content = readSource();
    expect(content).toContain("from '@mastra/core/agent'");
    expect(content).toContain("from '../clients/biomedical-mcp.js'");
    expect(content).toContain("from '../tools/deep-research.js'");
    expect(content).toContain("from '../tools/parallel-research.js'");
  });
});
