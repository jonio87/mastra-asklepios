import { reportAgent } from './report-agent.js';

describe('reportAgent', () => {
  it('has correct id', () => {
    expect(reportAgent.id).toBe('report-agent');
  });

  it('has correct agent name', () => {
    expect(reportAgent.name).toBe('Report Generation Agent');
  });

  it('has description mentioning three-register', () => {
    expect(reportAgent.getDescription()).toContain('three-register');
  });

  it('has description mentioning deliverables', () => {
    expect(reportAgent.getDescription()).toContain('deliverables');
  });

  it('has instructions about three registers', async () => {
    const instructions = await reportAgent.getInstructions();
    expect(instructions).toContain('Technical Register');
    expect(instructions).toContain('Accessible Register');
    expect(instructions).toContain('Structured Register');
  });

  it('has instructions about evidence provenance chains', async () => {
    const instructions = await reportAgent.getInstructions();
    expect(instructions).toContain('Evidence provenance chains');
    expect(instructions).toContain('evidence tier');
  });

  it('has instructions about multilingual support', async () => {
    const instructions = await reportAgent.getInstructions();
    expect(instructions).toContain('multilingual');
    expect(instructions).toContain('Polish');
  });

  it('has queryData, captureData, brainFeed tools', () => {
    const tools = reportAgent.listTools();
    expect(tools).toHaveProperty('queryData');
    expect(tools).toHaveProperty('captureData');
    expect(tools).toHaveProperty('brainFeed');
  });

  it('has exactly 4 tools configured', () => {
    const tools = reportAgent.listTools();
    expect(Object.keys(tools)).toHaveLength(4);
  });

  it('has knowledgeQuery tool', () => {
    const tools = reportAgent.listTools();
    expect(tools).toHaveProperty('knowledgeQuery');
  });
});
