import { brainAgent } from './brain-agent.js';

describe('brainAgent', () => {
  it('has correct agent id', () => {
    expect(brainAgent.id).toBe('asklepios-brain');
  });

  it('has correct agent name', () => {
    expect(brainAgent.name).toBe('Asklepios Brain');
  });

  it('has instructions about cross-patient patterns', async () => {
    const instructions = await brainAgent.getInstructions();
    expect(instructions).toContain('cross-patient');
    expect(instructions).toContain('anonymized');
  });

  it('has instructions about diagnostic shortcuts', async () => {
    const instructions = await brainAgent.getInstructions();
    expect(instructions).toContain('Diagnostic Shortcuts');
    expect(instructions).toContain('Common Misdiagnoses');
  });

  it('has instructions about privacy', async () => {
    const instructions = await brainAgent.getInstructions();
    expect(instructions).toContain('NEVER include patient identifiers');
  });

  it('has no tools (pure pattern extraction)', () => {
    const tools = brainAgent.listTools();
    expect(Object.keys(tools as Record<string, unknown>)).toHaveLength(0);
  });

  it('has brain memory configured', async () => {
    const memory = await brainAgent.getMemory();
    expect(memory).toBeDefined();
  });
});
