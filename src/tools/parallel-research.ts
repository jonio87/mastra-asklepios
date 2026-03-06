import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { logger } from '../utils/logger.js';
import { runDeepResearch } from '../utils/parallel-ai.js';

const ROLE_PREFIXES: Record<string, string> = {
  advocate:
    'Build the STRONGEST possible case FOR the following hypothesis. Find supporting evidence, case analogues, mechanism confirmations. Hypothesis: ',
  skeptic:
    'Build the STRONGEST possible case AGAINST the following hypothesis. Find contradicting evidence, alternative explanations, negative studies. Hypothesis: ',
  unbiased:
    'Provide balanced, evidence-weighted analysis. Identify what is genuinely uncertain vs well-established. Topic: ',
};

const ParallelSourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  excerpt: z.string(),
});

export const parallelResearchTool = createTool({
  id: 'parallel-research',
  description:
    'Conduct deep research using Parallel.ai. Produces a comprehensive markdown report with cited sources. Supports adversarial framing (advocate/skeptic/unbiased) for hypothesis testing. This is a long-running operation (up to 10 minutes for ultra processor).',
  inputSchema: z.object({
    query: z.string().describe('Research question or hypothesis to investigate'),
    context: z
      .string()
      .optional()
      .describe('Patient context or additional background to include in the research query'),
    processor: z
      .enum(['base', 'core', 'ultra'])
      .optional()
      .describe('Parallel.ai processor tier (default: ultra)'),
    role: z
      .enum(['advocate', 'skeptic', 'unbiased'])
      .optional()
      .describe('Adversarial framing role for hypothesis testing'),
  }),
  outputSchema: z.object({
    report: z.string().describe('Markdown research report'),
    sources: z.array(ParallelSourceSchema).describe('Cited sources with URLs'),
    processor: z.string().describe('Processor tier used'),
    durationMs: z.number().describe('Research duration in milliseconds'),
    available: z.boolean().describe('Whether Parallel.ai was available'),
  }),
  execute: async (inputData) => {
    const { query, context, processor = 'ultra', role } = inputData;

    const startTime = Date.now();

    // Build the full research input with optional adversarial framing
    let researchInput = query;

    if (role) {
      const prefix = ROLE_PREFIXES[role];
      if (prefix) {
        researchInput = `${prefix}${query}`;
      }
    }

    if (context) {
      researchInput = `${researchInput}\n\nAdditional context: ${context}`;
    }

    logger.info('Starting parallel research', { query, processor, role });

    const result = await runDeepResearch(researchInput, { processor });

    const durationMs = Date.now() - startTime;

    if (!result) {
      logger.warn('Parallel.ai not available or research failed', { query, durationMs });
      return {
        report: 'Parallel.ai not configured',
        sources: [],
        processor: 'none',
        durationMs: 0,
        available: false,
      };
    }

    logger.info('Parallel research complete', {
      query,
      processor,
      durationMs,
      sourceCount: result.sources.length,
    });

    return {
      report: result.output,
      sources: result.sources,
      processor,
      durationMs,
      available: true,
    };
  },
});
