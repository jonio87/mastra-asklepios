import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { mastra } from '../mastra.js';

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
      annotations: { readOnlyHint: false },
    },
    async ({ message, patientId, threadId }) => {
      const agent = mastra.getAgent('asklepios');
      const resourceId = patientId ?? 'asklepios-knowledge';
      const thread = threadId ?? crypto.randomUUID();

      const result = await agent.generate(message, {
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

  server.registerTool(
    'search_pubmed',
    {
      description:
        'Search PubMed for medical research articles and case reports related to rare diseases.',
      inputSchema: {
        query: z
          .string()
          .describe('Search query for PubMed (e.g., "Ehlers-Danlos joint hypermobility")'),
        maxResults: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .describe('Maximum number of results (default: 10)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, maxResults }) => {
      const agent = mastra.getAgent('asklepios');
      const tools = await agent.listTools();
      const pubmed = tools['pubmedSearch'];
      if (!pubmed?.execute) {
        return {
          content: [{ type: 'text' as const, text: 'PubMed search tool not available' }],
          isError: true,
        };
      }

      const result = await pubmed.execute({ query, maxResults: maxResults ?? 10 }, { mastra });

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
    'lookup_orphanet',
    {
      description:
        'Look up rare diseases in the Orphanet database. Search by name/keyword, or look up directly by ORPHAcode for detailed disease information including genes, inheritance mode, prevalence, and synonyms.',
      inputSchema: {
        query: z.string().describe('Disease name or keyword to search in Orphanet'),
        orphaCode: z
          .number()
          .optional()
          .describe('Specific ORPHAcode for direct lookup (bypasses text search)'),
        maxResults: z
          .number()
          .min(1)
          .max(20)
          .optional()
          .describe('Maximum number of search results (default: 5)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, orphaCode, maxResults }) => {
      const agent = mastra.getAgent('asklepios');
      const tools = await agent.listTools();
      const orphanet = tools['orphanetLookup'];
      if (!orphanet?.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Orphanet lookup tool not available' }],
          isError: true,
        };
      }

      const result = await orphanet.execute(
        { query, orphaCode, maxResults: maxResults ?? 5 },
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
      annotations: { readOnlyHint: true },
    },
    async ({ symptoms }) => {
      const agent = mastra.getAgent('asklepios');
      const tools = await agent.listTools();
      const hpoMapper = tools['hpoMapper'];
      if (!hpoMapper?.execute) {
        return {
          content: [{ type: 'text' as const, text: 'HPO mapper tool not available' }],
          isError: true,
        };
      }

      const result = await hpoMapper.execute({ symptoms }, { mastra });

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
      annotations: { readOnlyHint: true },
    },
    async ({ symptoms, hpoTerms }) => {
      const agent = mastra.getAgent('asklepios');
      const tools = await agent.listTools();
      const brainRecall = tools['brainRecall'];
      if (!brainRecall?.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Brain recall tool not available' }],
          isError: true,
        };
      }

      const result = await brainRecall.execute({ symptoms, hpoTerms: hpoTerms ?? [] }, { mastra });

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
