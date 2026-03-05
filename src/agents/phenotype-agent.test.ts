import { phenotypeAgent } from './phenotype-agent.js';

describe('phenotypeAgent', () => {
  it('has correct agent id', () => {
    expect(phenotypeAgent.id).toBe('phenotype-agent');
  });

  it('has correct agent name', () => {
    expect(phenotypeAgent.name).toBe('Phenotype Agent');
  });

  it('has instructions with HPO phenotyping process', async () => {
    const instructions = await phenotypeAgent.getInstructions();
    expect(instructions).toContain('Human Phenotype Ontology');
    expect(instructions).toContain('HPO');
  });

  it('has instructions about exhaustive symptom capture', async () => {
    const instructions = await phenotypeAgent.getInstructions();
    expect(instructions).toContain('Be exhaustive');
    expect(instructions).toContain('Preserve negatives');
  });
});
