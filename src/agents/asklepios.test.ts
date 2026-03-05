import { asklepiosAgent, defaultNetworkOptions } from './asklepios.js';

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

  it('has instructions about three-layer architecture', async () => {
    const instructions = await asklepiosAgent.getInstructions();
    expect(instructions).toContain('Three-Layer Clinical Knowledge Architecture');
  });

  it('has all required tools configured', () => {
    const tools = asklepiosAgent.listTools();
    expect(tools).toBeDefined();
  });

  // ─── Network Configuration ───────────────────────────────────────────

  describe('network configuration', () => {
    it('has sub-agents registered', async () => {
      const agents = await asklepiosAgent.listAgents();
      const agentIds = Object.keys(agents);
      expect(agentIds).toContain('phenotype-agent');
      expect(agentIds).toContain('research-agent');
      expect(agentIds).toContain('synthesis-agent');
      expect(agentIds).toContain('asklepios-brain');
    });

    it('has default network options configured', () => {
      expect(defaultNetworkOptions).toBeDefined();
      expect(defaultNetworkOptions.maxSteps).toBe(15);
    });

    it('has routing instructions for agent selection', () => {
      const routing = defaultNetworkOptions.routing;
      expect(routing).toBeDefined();
      expect(routing?.additionalInstructions).toContain('phenotype-agent');
      expect(routing?.additionalInstructions).toContain('research-agent');
      expect(routing?.additionalInstructions).toContain('synthesis-agent');
      expect(routing?.additionalInstructions).toContain('asklepios-brain');
    });

    it('has routing strategy for diagnostic workflows', () => {
      const routing = defaultNetworkOptions.routing;
      expect(routing?.additionalInstructions).toContain('Routing Strategy');
      expect(routing?.additionalInstructions).toContain('Completion Criteria');
    });

    it('has onIterationComplete callback', () => {
      expect(defaultNetworkOptions.onIterationComplete).toBeDefined();
      expect(typeof defaultNetworkOptions.onIterationComplete).toBe('function');
    });
  });
});
