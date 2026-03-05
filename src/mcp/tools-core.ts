import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { mastra } from '../mastra.js';
import { brainRecallTool } from '../tools/brain-recall.js';
import { clinvarLookupTool } from '../tools/clinvar-lookup.js';
import { hpoMapperTool } from '../tools/hpo-mapper.js';
import { orphanetLookupTool } from '../tools/orphanet-lookup.js';
import { pubmedSearchTool } from '../tools/pubmed-search.js';

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
      if (!pubmedSearchTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'PubMed search tool not available' }],
          isError: true,
        };
      }
      const result = await pubmedSearchTool.execute(
        { query, maxResults: maxResults ?? 10 },
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
      if (!orphanetLookupTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Orphanet lookup tool not available' }],
          isError: true,
        };
      }
      const result = await orphanetLookupTool.execute(
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
    'lookup_clinvar',
    {
      description:
        'Look up genetic variant pathogenicity in ClinVar. Search by gene symbol, HGVS variant notation, or free text to get clinical significance, review status, and associated conditions.',
      inputSchema: {
        query: z.string().optional().describe('Free text search query (e.g., "Ehlers-Danlos")'),
        gene: z
          .string()
          .optional()
          .describe('Gene symbol for field-specific search (e.g., "COL3A1")'),
        variant: z
          .string()
          .optional()
          .describe('HGVS notation for variant-specific search (e.g., "c.1854+1G>A")'),
        maxResults: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .describe('Maximum number of results to return (default: 10)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, gene, variant, maxResults }) => {
      if (!clinvarLookupTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'ClinVar lookup tool not available' }],
          isError: true,
        };
      }
      const result = await clinvarLookupTool.execute(
        {
          ...(query !== undefined ? { query } : {}),
          ...(gene !== undefined ? { gene } : {}),
          ...(variant !== undefined ? { variant } : {}),
          maxResults: maxResults ?? 10,
        },
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
      annotations: { readOnlyHint: true },
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
