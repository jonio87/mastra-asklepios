import { synthesisAgent } from './synthesis-agent.js';

describe('synthesisAgent', () => {
  it('has correct agent id', () => {
    expect(synthesisAgent.id).toBe('synthesis-agent');
  });

  it('has correct agent name', () => {
    expect(synthesisAgent.name).toBe('Synthesis Agent');
  });

  it('has instructions with synthesis framework', async () => {
    const instructions = await synthesisAgent.getInstructions();
    expect(instructions).toContain('Evidence Inventory');
    expect(instructions).toContain('Hypothesis Generation');
    expect(instructions).toContain('Hypothesis Ranking');
  });

  it('has instructions with self-reflection loop', async () => {
    const instructions = await synthesisAgent.getInstructions();
    expect(instructions).toContain('Self-Reflection Loop');
  });

  it('has instructions requiring differential diagnosis', async () => {
    const instructions = await synthesisAgent.getInstructions();
    expect(instructions).toContain('NEVER present a single diagnosis as definitive');
    expect(instructions).toContain('differential');
  });

  it('has 3 tools configured for evidence access', () => {
    const tools = synthesisAgent.listTools();
    expect(Object.keys(tools)).toHaveLength(3);
    expect(tools).toHaveProperty('queryData');
    expect(tools).toHaveProperty('knowledgeQuery');
    expect(tools).toHaveProperty('captureData');
  });
});
