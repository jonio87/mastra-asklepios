import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { mastra } from '../mastra.js';
import { clinicalTrialsTool } from '../tools/clinical-trials.js';
import { ddxGeneratorTool } from '../tools/ddx-generator.js';
import { evidenceSearchTool } from '../tools/evidence-search.js';
import { openfdaLookupTool } from '../tools/openfda-lookup.js';

/**
 * Validation tools — clinical trials, drug safety, evidence search, and DDx.
 * Provides external data sources for hypothesis validation and citation verification.
 */
export function registerValidationTools(server: McpServer): void {
  server.registerTool(
    'search_clinical_trials',
    {
      description:
        'Search ClinicalTrials.gov for clinical studies by condition, intervention, phase, status, or NCT ID. Find recruiting trials relevant to patient conditions.',
      inputSchema: {
        query: z.string().optional().describe('Free-text search query'),
        nctId: z.string().optional().describe('Specific NCT ID to look up'),
        condition: z.string().optional().describe('Filter by condition/disease'),
        intervention: z.string().optional().describe('Filter by intervention/treatment'),
        phase: z
          .enum(['EARLY_PHASE1', 'PHASE1', 'PHASE2', 'PHASE3', 'PHASE4', 'NA'])
          .optional()
          .describe('Filter by study phase'),
        status: z
          .enum([
            'RECRUITING',
            'NOT_YET_RECRUITING',
            'ACTIVE_NOT_RECRUITING',
            'COMPLETED',
            'TERMINATED',
            'WITHDRAWN',
            'SUSPENDED',
          ])
          .optional()
          .describe('Filter by recruitment status'),
        locationCountry: z.string().optional().describe('Filter by country'),
        maxResults: z.number().min(1).max(50).optional().describe('Max results (default: 10)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      if (!clinicalTrialsTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Clinical trials tool not available' }],
          isError: true,
        };
      }
      const result = await clinicalTrialsTool.execute(input, { mastra });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'lookup_openfda',
    {
      description:
        'Search FDA adverse event reports (FAERS) and drug labeling. Count adverse reactions for a drug, check specific drug-reaction associations, or get label info.',
      inputSchema: {
        drugName: z.string().describe('Drug name (brand or generic)'),
        mode: z
          .enum(['adverse-events', 'label'])
          .optional()
          .describe('Search mode (default: adverse-events)'),
        reactionTerm: z
          .string()
          .optional()
          .describe('Specific adverse reaction to check (MedDRA term)'),
        topN: z.number().min(1).max(100).optional().describe('Top N adverse reactions to return'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      if (!openfdaLookupTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'OpenFDA tool not available' }],
          isError: true,
        };
      }
      const result = await openfdaLookupTool.execute(input, { mastra });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'search_evidence',
    {
      description:
        'Search for high-quality evidence: Cochrane systematic reviews, meta-analyses, RCTs, and guidelines. Supports PICO-structured queries.',
      inputSchema: {
        query: z.string().optional().describe('Free-text search query'),
        population: z.string().optional().describe('PICO: Patient population'),
        intervention: z.string().optional().describe('PICO: Intervention'),
        comparison: z.string().optional().describe('PICO: Comparison'),
        outcome: z.string().optional().describe('PICO: Outcome'),
        evidenceTypes: z
          .array(z.enum(['systematic-review', 'meta-analysis', 'rct', 'guideline']))
          .optional()
          .describe('Evidence types to include'),
        includeCochrane: z.boolean().optional().describe('Include Cochrane Library search'),
        maxResults: z.number().min(1).max(50).optional().describe('Max results per type'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      if (!evidenceSearchTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Evidence search tool not available' }],
          isError: true,
        };
      }
      const result = await evidenceSearchTool.execute(input, { mastra });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'generate_ddx',
    {
      description:
        'Generate a differential diagnosis from clinical features. Uses internal pattern matching and, when configured, Isabel DDx API for independent validation.',
      inputSchema: {
        clinicalFeatures: z
          .array(z.string())
          .min(1)
          .describe('Clinical features (symptoms, signs, findings)'),
        labResults: z.array(z.string()).optional().describe('Laboratory results'),
        age: z.number().min(0).max(120).describe('Patient age'),
        sex: z.enum(['male', 'female']).describe('Patient biological sex'),
        region: z.string().optional().describe('Geographic region'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      if (!ddxGeneratorTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'DDx generator tool not available' }],
          isError: true,
        };
      }
      const result = await ddxGeneratorTool.execute(input, { mastra });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
