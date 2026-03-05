import { researchAgent } from './research-agent.js';

describe('researchAgent', () => {
  it('has correct agent id', () => {
    expect(researchAgent.id).toBe('research-agent');
  });

  it('has correct agent name', () => {
    expect(researchAgent.name).toBe('Research Agent');
  });

  it('has instructions with research strategy', async () => {
    const instructions = await researchAgent.getInstructions();
    expect(instructions).toContain('Research Strategy');
    expect(instructions).toContain('MeSH terms');
  });

  it('has instructions emphasizing evidence quality', async () => {
    const instructions = await researchAgent.getInstructions();
    expect(instructions).toContain('evidence');
    expect(instructions).toContain('PMIDs');
  });

  it('has instructions clarifying research-only role', async () => {
    const instructions = await researchAgent.getInstructions();
    expect(instructions).toContain('research tool');
    expect(instructions).toContain('NOT a diagnostic tool');
  });
});
