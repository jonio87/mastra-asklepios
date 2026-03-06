import { followupAgent } from './followup-agent.js';

describe('followupAgent', () => {
  it('has correct id', () => {
    expect(followupAgent.id).toBe('followup-agent');
  });

  it('has correct agent name', () => {
    expect(followupAgent.name).toBe('Follow-Up Question Agent');
  });

  it('has description mentioning follow-up questions', () => {
    expect(followupAgent.getDescription()).toContain('follow-up questions');
  });

  it('has description mentioning hypothesis gaps', () => {
    expect(followupAgent.getDescription()).toContain('hypothesis gaps');
  });

  it('has instructions about question format', async () => {
    const instructions = await followupAgent.getInstructions();
    expect(instructions).toContain('Question Format');
    expect(instructions).toContain('Purpose');
  });

  it('has instructions about answer routing logic', async () => {
    const instructions = await followupAgent.getInstructions();
    expect(instructions).toContain('Answer Routing Logic');
    expect(instructions).toContain('Hypothesis-shifting');
    expect(instructions).toContain('Model-breaking');
  });

  it('has queryData and captureData tools', () => {
    const tools = followupAgent.listTools();
    expect(tools).toHaveProperty('queryData');
    expect(tools).toHaveProperty('captureData');
  });

  it('has exactly 2 tools configured', () => {
    const tools = followupAgent.listTools();
    expect(Object.keys(tools)).toHaveLength(2);
  });

  it('does not have knowledgeQuery tool', () => {
    const tools = followupAgent.listTools();
    expect(tools).not.toHaveProperty('knowledgeQuery');
  });
});
