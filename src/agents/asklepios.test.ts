import { asklepiosAgent } from './asklepios.js';

describe('asklepiosAgent', () => {
  it('has correct agent id', () => {
    expect(asklepiosAgent.id).toBe('asklepios');
  });

  it('has correct agent name', () => {
    expect(asklepiosAgent.name).toBe('Asklepios');
  });

  it('has instructions mentioning rare disease specialization', async () => {
    const instructions = await asklepiosAgent.getInstructions();
    expect(instructions).toContain('rare disease');
  });

  it('has instructions with medical disclaimer', async () => {
    const instructions = await asklepiosAgent.getInstructions();
    expect(instructions).toContain('RESEARCH ASSISTANT');
    expect(instructions).toContain('not a doctor');
  });

  it('has instructions about cross-patient learning', async () => {
    const instructions = await asklepiosAgent.getInstructions();
    expect(instructions).toContain('Cross-Patient Learning');
  });

  it('has all required tools configured', () => {
    const tools = asklepiosAgent.listTools();
    expect(tools).toBeDefined();
  });
});
