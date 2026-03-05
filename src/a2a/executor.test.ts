import { describe, expect, it, jest } from '@jest/globals';

/**
 * Mock mastra to avoid @mastra/core ESM dependency chain in tests.
 */
jest.mock('../mastra.js', () => ({
  mastra: {
    getAgent: jest.fn(() => ({
      generate: jest.fn(),
      stream: jest.fn(),
      network: jest.fn(),
    })),
  },
}));

jest.mock('../utils/max-steps.js', () => ({
  resolveMaxSteps: jest.fn(() => 10),
}));

jest.mock('../utils/observability.js', () => ({
  traceOnFinish: jest.fn(() => jest.fn()),
  traceOnStepFinish: jest.fn(() => jest.fn()),
}));

/**
 * Test skill detection and agent routing logic.
 */
describe('AsklepiosExecutor', () => {
  it('exports AsklepiosExecutor class', async () => {
    const mod = await import('./executor.js');
    expect(mod.AsklepiosExecutor).toBeDefined();
    expect(typeof mod.AsklepiosExecutor).toBe('function');
  });

  it('can be instantiated', async () => {
    const mod = await import('./executor.js');
    const executor = new mod.AsklepiosExecutor();
    expect(executor).toBeDefined();
    expect(typeof executor.execute).toBe('function');
    expect(typeof executor.cancelTask).toBe('function');
  });
});

describe('A2A module exports', () => {
  it('exports getAgentCard', async () => {
    const mod = await import('./agent-card.js');
    expect(typeof mod.getAgentCard).toBe('function');
  });

  it('exports createA2aServer', async () => {
    const mod = await import('./server.js');
    expect(typeof mod.createA2aServer).toBe('function');
  });

  it('exports all from index', async () => {
    const mod = await import('./index.js');
    expect(mod.getAgentCard).toBeDefined();
    expect(mod.AsklepiosExecutor).toBeDefined();
    expect(mod.createA2aServer).toBeDefined();
  });
});
