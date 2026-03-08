import { hypothesisAgent } from './hypothesis-agent.js';

describe('hypothesisAgent', () => {
  it('has correct id', () => {
    expect(hypothesisAgent.id).toBe('hypothesis-agent');
  });

  it('has correct agent name', () => {
    expect(hypothesisAgent.name).toBe('Hypothesis Generation Agent');
  });

  it('has description mentioning hypothesis', () => {
    expect(hypothesisAgent.getDescription()).toContain('hypothesis');
  });

  it('has description mentioning tier-weighted confidence', () => {
    expect(hypothesisAgent.getDescription()).toContain('tier-weighted');
  });

  it('has instructions about evidence tier weighting', async () => {
    const instructions = await hypothesisAgent.getInstructions();
    expect(instructions).toContain('Evidence Tier Weighting');
    expect(instructions).toContain('T1-official');
    expect(instructions).toContain('T2-patient-reported');
    expect(instructions).toContain('T3-ai-inferred');
  });

  it('has instructions about gap identification', async () => {
    const instructions = await hypothesisAgent.getInstructions();
    expect(instructions).toContain('Gap Identification');
    expect(instructions).toContain('SINGLE TEST');
  });

  it('has queryData, captureData, knowledgeQuery, ddxGenerator tools', () => {
    const tools = hypothesisAgent.listTools();
    expect(tools).toHaveProperty('queryData');
    expect(tools).toHaveProperty('captureData');
    expect(tools).toHaveProperty('knowledgeQuery');
    expect(tools).toHaveProperty('ddxGenerator');
  });

  it('has exactly 4 tools configured', () => {
    const tools = hypothesisAgent.listTools();
    expect(Object.keys(tools)).toHaveLength(4);
  });
});
