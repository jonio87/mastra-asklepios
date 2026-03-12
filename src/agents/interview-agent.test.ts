import { interviewAgent } from './interview-agent.js';

describe('interviewAgent', () => {
  it('has correct id', () => {
    expect(interviewAgent.id).toBe('interview-agent');
  });

  it('has correct agent name', () => {
    expect(interviewAgent.name).toBe('Interview Agent');
  });

  it('has description mentioning cross-referencing', () => {
    expect(interviewAgent.getDescription()).toContain('Cross-references');
  });

  it('has description mentioning diagnostic questions', () => {
    expect(interviewAgent.getDescription()).toContain('diagnostic questions');
  });

  it('has instructions about cross-referencing rules', async () => {
    const instructions = await interviewAgent.getInstructions();
    expect(instructions).toContain('Cross-Referencing Rules');
    expect(instructions).toContain('CONFIRMED');
    expect(instructions).toContain('CONTRADICTED');
    expect(instructions).toContain('UNVALIDATED');
  });

  it('has instructions about question categorization', async () => {
    const instructions = await interviewAgent.getInstructions();
    expect(instructions).toContain('Question Categorization');
    expect(instructions).toContain('records-gap');
  });

  it('has queryData tool', () => {
    const tools = interviewAgent.listTools();
    expect(tools).toHaveProperty('queryData');
  });

  it('has captureData tool', () => {
    const tools = interviewAgent.listTools();
    expect(tools).toHaveProperty('captureData');
  });

  it('has knowledgeQuery tool', () => {
    const tools = interviewAgent.listTools();
    expect(tools).toHaveProperty('knowledgeQuery');
  });

  it('has exactly 3 tools configured', () => {
    const tools = interviewAgent.listTools();
    expect(Object.keys(tools)).toHaveLength(3);
  });
});
