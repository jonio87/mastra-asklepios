import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { mastra } from '../mastra.js';
import { adversarialSynthesisTool } from '../tools/adversarial-synthesis.js';
import { parallelResearchTool } from '../tools/parallel-research.js';

/**
 * Research tools — adversarial research and synthesis via Parallel.ai.
 * Provides deep research with role-based framing and three-perspective analysis.
 */
export function registerResearchTools(server: McpServer): void {
  server.registerTool(
    'parallel_deep_research',
    {
      description:
        'Run ultra-deep research on a topic using Parallel.ai. Supports adversarial framing (advocate/skeptic/unbiased roles). Returns markdown report with citations. Requires PARALLEL_API_KEY env var.',
      inputSchema: {
        query: z.string().describe('Research question or hypothesis to investigate'),
        context: z.string().optional().describe('Additional context to guide the research'),
        processor: z
          .enum(['base', 'core', 'ultra'])
          .optional()
          .describe('Research depth: base (fast), core (balanced), ultra (deepest, ~10 min)'),
        role: z
          .enum(['advocate', 'skeptic', 'unbiased'])
          .optional()
          .describe(
            'Adversarial framing role: advocate (build case FOR), skeptic (build case AGAINST), unbiased (balanced)',
          ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      if (!parallelResearchTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Parallel research tool not available' }],
          isError: true,
        };
      }
      const result = await parallelResearchTool.execute(input, { mastra });

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
    'adversarial_synthesis',
    {
      description:
        'Run three-perspective adversarial analysis (advocate/skeptic/unbiased). External mode uses Parallel.ai ultra-deep research (20+ min). Internal mode uses orchestrator-driven synthesis.',
      inputSchema: {
        hypothesis: z.string().describe('Diagnostic hypothesis to evaluate adversarially'),
        patientContext: z.string().describe('Patient clinical context for grounding the analysis'),
        mode: z
          .enum(['internal', 'external'])
          .describe(
            'Execution mode: external (Parallel.ai, deeper but slower) or internal (orchestrator-driven)',
          ),
        processor: z
          .enum(['ultra', 'ultra2x'])
          .optional()
          .describe('Parallel.ai processor tier (external mode only)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      if (!adversarialSynthesisTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Adversarial synthesis tool not available' }],
          isError: true,
        };
      }
      const result = await adversarialSynthesisTool.execute(input, { mastra });

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
