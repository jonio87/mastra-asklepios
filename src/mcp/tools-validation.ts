import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { mastra } from '../mastra.js';
import { ddxGeneratorTool } from '../tools/ddx-generator.js';

/**
 * Validation tools — DDx generation for hypothesis validation.
 * Clinical trials, drug safety, and evidence search are now proxied from
 * upstream biomedical MCP servers via tools-biomedical.ts.
 */
export function registerValidationTools(server: McpServer): void {
  // search_clinical_trials, lookup_openfda, search_evidence removed —
  // now proxied from upstream biomedical MCP servers via tools-biomedical.ts

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
