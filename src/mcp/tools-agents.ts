import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { mastra } from '../mastra.js';

/**
 * Agent invocation tools — direct access to each specialized agent.
 * Enables AI testers to invoke agents independently for modular testing.
 */
export function registerAgentTools(server: McpServer): void {
  server.registerTool(
    'invoke_phenotype_agent',
    {
      description:
        'Invoke the Phenotype Agent directly. Extracts symptoms from clinical text, maps them to HPO terms, identifies negative phenotypes, and categorizes by organ system.',
      inputSchema: {
        message: z.string().describe('Clinical text or question for the phenotype agent'),
        patientId: z.string().optional().describe('Patient resource ID for memory scoping'),
        threadId: z.string().optional().describe('Thread ID to continue a conversation'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ message, patientId, threadId }) => {
      const agent = mastra.getAgent('phenotypeAgent');
      const resourceId = patientId ?? 'asklepios-knowledge';
      const thread = threadId ?? crypto.randomUUID();

      const result = await agent.generate(message, {
        memory: { thread, resource: resourceId },
      });

      return {
        content: [{ type: 'text' as const, text: result.text }],
      };
    },
  );

  server.registerTool(
    'invoke_research_agent',
    {
      description:
        'Invoke the Research Agent directly. Searches PubMed, Orphanet, and deep research sources. Rates evidence quality and provides source citations.',
      inputSchema: {
        message: z.string().describe('Research question or query for the research agent'),
        patientId: z.string().optional().describe('Patient resource ID for memory scoping'),
        threadId: z.string().optional().describe('Thread ID to continue a conversation'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ message, patientId, threadId }) => {
      const agent = mastra.getAgent('researchAgent');
      const resourceId = patientId ?? 'asklepios-knowledge';
      const thread = threadId ?? crypto.randomUUID();

      const result = await agent.generate(message, {
        memory: { thread, resource: resourceId },
      });

      return {
        content: [{ type: 'text' as const, text: result.text }],
      };
    },
  );

  server.registerTool(
    'invoke_synthesis_agent',
    {
      description:
        'Invoke the Synthesis Agent directly. Combines research findings, phenotypes, and clinical data into ranked diagnostic hypotheses with confidence scores and evidence chains.',
      inputSchema: {
        message: z
          .string()
          .describe('Clinical findings and research data for the synthesis agent to analyze'),
        patientId: z.string().optional().describe('Patient resource ID for memory scoping'),
        threadId: z.string().optional().describe('Thread ID to continue a conversation'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ message, patientId, threadId }) => {
      const agent = mastra.getAgent('synthesisAgent');
      const resourceId = patientId ?? 'asklepios-knowledge';
      const thread = threadId ?? crypto.randomUUID();

      const result = await agent.generate(message, {
        memory: { thread, resource: resourceId },
      });

      return {
        content: [{ type: 'text' as const, text: result.text }],
      };
    },
  );

  server.registerTool(
    'invoke_brain_agent',
    {
      description:
        'Invoke the Brain Agent directly. Cross-patient diagnostic wisdom accumulator — extracts patterns, diagnostic shortcuts, common misdiagnoses, and phenotype-genotype correlations from anonymized case data.',
      inputSchema: {
        message: z
          .string()
          .describe('Anonymized case observation or pattern query for the brain agent'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ message }) => {
      const agent = mastra.getAgent('asklepios-brain');
      const thread = crypto.randomUUID();

      const result = await agent.generate(message, {
        memory: { thread, resource: 'asklepios-brain' },
      });

      return {
        content: [{ type: 'text' as const, text: result.text }],
      };
    },
  );
}
