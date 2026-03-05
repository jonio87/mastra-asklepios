import { mastra } from './mastra.js';

describe('mastra instance', () => {
  it('is defined', () => {
    expect(mastra).toBeDefined();
  });

  it('has asklepios agent registered', () => {
    const agent = mastra.getAgent('asklepios');
    expect(agent).toBeDefined();
    expect(agent.name).toBe('Asklepios');
  });

  it('has research agent registered', () => {
    const agent = mastra.getAgent('researchAgent');
    expect(agent).toBeDefined();
    expect(agent.name).toBe('Research Agent');
  });

  it('has phenotype agent registered', () => {
    const agent = mastra.getAgent('phenotypeAgent');
    expect(agent).toBeDefined();
    expect(agent.name).toBe('Phenotype Agent');
  });

  it('has synthesis agent registered', () => {
    const agent = mastra.getAgent('synthesisAgent');
    expect(agent).toBeDefined();
    expect(agent.name).toBe('Synthesis Agent');
  });

  it('has brain agent registered', () => {
    const agent = mastra.getAgent('asklepios-brain');
    expect(agent).toBeDefined();
    expect(agent.name).toBe('Asklepios Brain');
  });

  it('has patient-intake workflow registered', () => {
    const workflow = mastra.getWorkflow('patient-intake');
    expect(workflow).toBeDefined();
  });

  it('has diagnostic-research workflow registered', () => {
    const workflow = mastra.getWorkflow('diagnostic-research');
    expect(workflow).toBeDefined();
  });

  it('agents have memory configured', async () => {
    const asklepios = mastra.getAgent('asklepios');
    const memory = await asklepios.getMemory();
    expect(memory).toBeDefined();
  });

  it('all agents share the same memory instance', async () => {
    const asklepios = mastra.getAgent('asklepios');
    const research = mastra.getAgent('researchAgent');
    const phenotype = mastra.getAgent('phenotypeAgent');
    const synthesis = mastra.getAgent('synthesisAgent');

    const [m1, m2, m3, m4] = await Promise.all([
      asklepios.getMemory(),
      research.getMemory(),
      phenotype.getMemory(),
      synthesis.getMemory(),
    ]);

    expect(m1).toBe(m2);
    expect(m2).toBe(m3);
    expect(m3).toBe(m4);
  });
});
