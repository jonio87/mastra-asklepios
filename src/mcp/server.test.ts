/* eslint-disable @typescript-eslint/no-unsafe-return */
import { jest } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerAgentTools } from './tools-agents.js';
import { registerCoreTools } from './tools-core.js';
import { registerStateTools } from './tools-state.js';
import { registerTaskTools } from './tools-tasks.js';
import { registerWorkflowTools } from './tools-workflows.js';

/**
 * Mock mastra and memory modules to avoid @mastra/core ESM dependency chain.
 * This lets us test MCP tool/resource/prompt registration without live agents.
 */
jest.mock('../mastra.js', () => ({
  mastra: {
    getAgent: jest.fn(() => ({
      generate: jest.fn(),
      stream: jest.fn(),
      listTools: jest.fn(() => ({})),
    })),
    getWorkflow: jest.fn(() => ({
      createRun: jest.fn(),
      runs: new Map(),
    })),
  },
}));

jest.mock('../memory.js', () => ({
  storage: {
    getStore: jest.fn(() => Promise.resolve(null)),
  },
  memory: {},
  brainMemory: {},
}));

/**
 * Helper to access private McpServer internals for testing.
 * McpServer stores registered items as plain record objects.
 */
function getServerInternals(server: McpServer) {
  const raw = server as unknown as Record<string, Record<string, unknown>>;
  return {
    tools: raw['_registeredTools'] ?? {},
    resources: raw['_registeredResources'] ?? {},
    resourceTemplates: raw['_registeredResourceTemplates'] ?? {},
    prompts: raw['_registeredPrompts'] ?? {},
  };
}

function createTestServer(): McpServer {
  return new McpServer(
    { name: 'asklepios-test', version: '0.0.0' },
    { capabilities: { resources: {}, tools: {}, prompts: {} } },
  );
}

describe('MCP Server', () => {
  describe('full server creation', () => {
    it('creates server with all registrations', async () => {
      const { createAsklepiosMcpServer } = await import('./server.js');
      const server = createAsklepiosMcpServer();
      expect(server).toBeInstanceOf(McpServer);
    });

    it('registers correct total counts', async () => {
      const { createAsklepiosMcpServer } = await import('./server.js');
      const server = createAsklepiosMcpServer();
      const { tools, resources, resourceTemplates, prompts } = getServerInternals(server);

      expect(Object.keys(tools).length).toBe(29);
      expect(Object.keys(resources).length + Object.keys(resourceTemplates).length).toBe(7);
      expect(Object.keys(prompts).length).toBe(4);
    });
  });

  describe('registerCoreTools', () => {
    const server = createTestServer();
    registerCoreTools(server);
    const { tools } = getServerInternals(server);
    const toolNames = Object.keys(tools);

    it('registers exactly 6 core tools', () => {
      expect(toolNames.length).toBe(6);
    });

    it.each([
      'ask_asklepios',
      'search_pubmed',
      'lookup_orphanet',
      'lookup_clinvar',
      'map_symptoms',
      'recall_brain',
    ])('registers %s', (name) => {
      expect(toolNames).toContain(name);
    });
  });

  describe('registerAgentTools', () => {
    const server = createTestServer();
    registerAgentTools(server);
    const { tools } = getServerInternals(server);
    const toolNames = Object.keys(tools);

    it('registers exactly 4 agent tools', () => {
      expect(toolNames.length).toBe(4);
    });

    it.each([
      'invoke_phenotype_agent',
      'invoke_research_agent',
      'invoke_synthesis_agent',
      'invoke_brain_agent',
    ])('registers %s', (name) => {
      expect(toolNames).toContain(name);
    });
  });

  describe('registerWorkflowTools', () => {
    const server = createTestServer();
    registerWorkflowTools(server);
    const { tools } = getServerInternals(server);
    const toolNames = Object.keys(tools);

    it('registers exactly 3 workflow tools', () => {
      expect(toolNames.length).toBe(3);
    });

    it.each([
      'run_patient_intake',
      'run_diagnostic_research',
      'resume_workflow',
    ])('registers %s', (name) => {
      expect(toolNames).toContain(name);
    });
  });

  describe('registerStateTools', () => {
    const server = createTestServer();
    registerStateTools(server);
    const { tools } = getServerInternals(server);
    const toolNames = Object.keys(tools);

    it('registers exactly 5 state tools', () => {
      expect(toolNames.length).toBe(5);
    });

    it.each([
      'get_working_memory',
      'list_threads',
      'get_thread_messages',
      'parse_document',
      'deep_research',
    ])('registers %s', (name) => {
      expect(toolNames).toContain(name);
    });
  });

  describe('registerTaskTools', () => {
    const server = createTestServer();
    registerTaskTools(server);
    const { tools } = getServerInternals(server);
    const toolNames = Object.keys(tools);

    it('registers exactly 2 task tools', () => {
      expect(toolNames.length).toBe(2);
    });

    it.each(['run_deep_research', 'run_diagnostic_workflow'])('registers %s', (name) => {
      expect(toolNames).toContain(name);
    });
  });

  describe('registerResources', () => {
    const server = createTestServer();
    registerResources(server);
    const { resources, resourceTemplates } = getServerInternals(server);

    it('registers 4 static resources', () => {
      const staticNames = Object.keys(resources);
      expect(staticNames.length).toBe(4);
      expect(staticNames).toContain('system://health');
      expect(staticNames).toContain('system://agents');
      expect(staticNames).toContain('system://workflows');
      expect(staticNames).toContain('system://memory/stats');
    });

    it('registers 3 resource templates', () => {
      const templateNames = Object.keys(resourceTemplates);
      expect(templateNames.length).toBe(3);
      expect(templateNames).toContain('patient-profile');
      expect(templateNames).toContain('patient-timeline');
      expect(templateNames).toContain('agent-config');
    });

    it('registers total of 7 resources', () => {
      const total = Object.keys(resources).length + Object.keys(resourceTemplates).length;
      expect(total).toBe(7);
    });
  });

  describe('registerPrompts', () => {
    const server = createTestServer();
    registerPrompts(server);
    const { prompts } = getServerInternals(server);
    const promptNames = Object.keys(prompts);

    it('registers exactly 4 prompts', () => {
      expect(promptNames.length).toBe(4);
    });

    it.each([
      'diagnose_patient',
      'review_case',
      'compare_patients',
      'test_scenario',
    ])('registers %s', (name) => {
      expect(promptNames).toContain(name);
    });
  });

  describe('module exports', () => {
    it('exports registerCoreTools as function', () => {
      expect(typeof registerCoreTools).toBe('function');
    });

    it('exports registerAgentTools as function', () => {
      expect(typeof registerAgentTools).toBe('function');
    });

    it('exports registerWorkflowTools as function', () => {
      expect(typeof registerWorkflowTools).toBe('function');
    });

    it('exports registerStateTools as function', () => {
      expect(typeof registerStateTools).toBe('function');
    });

    it('exports registerResources as function', () => {
      expect(typeof registerResources).toBe('function');
    });

    it('exports registerPrompts as function', () => {
      expect(typeof registerPrompts).toBe('function');
    });
  });
});
