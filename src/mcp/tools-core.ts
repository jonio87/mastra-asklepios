import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mastra } from '../mastra.js';
import { brainRecallTool } from '../tools/brain-recall.js';
import { hpoMapperTool } from '../tools/hpo-mapper.js';
import { resolveMaxSteps } from '../utils/max-steps.js';

/**
 * Core tools — the original 5 Asklepios MCP tools.
 * Provides chat, literature search, disease lookup, symptom mapping, and brain recall.
 */
export function registerCoreTools(server: McpServer): void {
  server.registerTool(
    'ask_asklepios',
    {
      description:
        'Chat with Asklepios, the rare disease research assistant. Maintains conversation memory per patient. Use threadId to continue a conversation, or omit for a new thread.',
      inputSchema: {
        message: z.string().describe('Your message to Asklepios'),
        patientId: z
          .string()
          .optional()
          .describe('Patient resource ID for memory scoping (e.g., "patient-001")'),
        threadId: z
          .string()
          .optional()
          .describe('Thread ID to continue a conversation. Omit for new thread.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ message, patientId, threadId }) => {
      const agent = mastra.getAgent('asklepios');
      const resourceId = patientId ?? 'asklepios-knowledge';
      const thread = threadId ?? crypto.randomUUID();

      const result = await agent.generate(message, {
        maxSteps: resolveMaxSteps(message),
        memory: {
          thread,
          resource: resourceId,
        },
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: result.text,
          },
        ],
      };
    },
  );

  // search_pubmed, lookup_orphanet, lookup_clinvar removed — now proxied from upstream
  // biomedical MCP servers via tools-biomedical.ts (biomcp_article_searcher, etc.)

  server.registerTool(
    'map_symptoms',
    {
      description:
        'Map free-text symptoms to standardized HPO (Human Phenotype Ontology) terms. Useful for phenotype analysis.',
      inputSchema: {
        symptoms: z
          .array(z.string())
          .describe(
            'List of symptoms to map (e.g., ["joint hypermobility", "skin hyperextensibility"])',
          ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ symptoms }) => {
      if (!hpoMapperTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'HPO mapper tool not available' }],
          isError: true,
        };
      }
      const result = await hpoMapperTool.execute({ symptoms }, { mastra });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'recall_brain',
    {
      description:
        'Query the Asklepios Brain for cross-patient diagnostic patterns. Returns diagnostic shortcuts, common misdiagnoses, and key differentiators from past cases.',
      inputSchema: {
        symptoms: z
          .array(z.string())
          .describe('Current patient symptoms to match against brain patterns'),
        hpoTerms: z
          .array(z.string())
          .optional()
          .describe('HPO term IDs for precise matching (e.g., ["HP:0001252"])'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ symptoms, hpoTerms }) => {
      if (!brainRecallTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Brain recall tool not available' }],
          isError: true,
        };
      }
      const result = await brainRecallTool.execute(
        { symptoms, hpoTerms: hpoTerms ?? [] },
        { mastra },
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
