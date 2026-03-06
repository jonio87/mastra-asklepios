import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { runDeepResearch } from '../utils/parallel-ai.js';

const SourceSchema = z.object({
  url: z.string().describe('URL of the source'),
  title: z.string().describe('Title of the source'),
  excerpt: z.string().describe('Relevant excerpt from the source'),
});

const RoleReportSchema = z.object({
  report: z.string().describe('Full research report text'),
  sources: z.array(SourceSchema).describe('Sources cited in the report'),
  durationMs: z.number().describe('Time taken in milliseconds'),
});

const SynthesisSchema = z.object({
  convergence: z.array(z.string()).describe('Points where all 3 perspectives agree'),
  divergence: z.array(z.string()).describe('Points of genuine disagreement between perspectives'),
  informativeTests: z
    .array(z.string())
    .describe('Tests or investigations that would resolve disagreements'),
  summary: z.string().describe('Overall synthesis summary'),
});

const OutputSchema = z.object({
  mode: z.string().describe('Execution mode used: internal or external'),
  advocate: RoleReportSchema.describe(
    'Report from the advocate perspective (proving the hypothesis)',
  ),
  skeptic: RoleReportSchema.describe(
    'Report from the skeptic perspective (challenging the hypothesis)',
  ),
  unbiased: RoleReportSchema.describe('Report from the unbiased arbiter perspective'),
  synthesis: SynthesisSchema.describe('Cross-perspective synthesis'),
});

type RoleType = 'advocate' | 'skeptic' | 'unbiased';

function buildPrompt(role: RoleType, hypothesis: string, patientContext: string): string {
  const roleInstructions: Record<RoleType, string> = {
    advocate: [
      'You are a MEDICAL ADVOCATE researcher. Your task is to find the STRONGEST possible evidence',
      'SUPPORTING the following hypothesis. Search for case reports, genetic studies, mechanistic',
      'pathways, and clinical evidence that would PROVE this hypothesis correct.',
    ].join(' '),
    skeptic: [
      'You are a MEDICAL SKEPTIC researcher. Your task is to find the STRONGEST possible evidence',
      'AGAINST the following hypothesis. Search for alternative diagnoses, contradictory findings,',
      'methodological weaknesses, and evidence that would DISPROVE this hypothesis.',
    ].join(' '),
    unbiased: [
      'You are an UNBIASED MEDICAL ARBITER. Your task is to conduct a balanced, objective evaluation',
      'of the following hypothesis. Weigh evidence for and against equally, assign probability',
      'estimates, and identify what additional evidence would be most informative.',
    ].join(' '),
  };

  return [
    roleInstructions[role],
    '',
    `## Hypothesis`,
    hypothesis,
    '',
    `## Patient Context`,
    patientContext,
  ].join('\n');
}

function buildEmptyReport(message: string): {
  report: string;
  sources: Array<{ url: string; title: string; excerpt: string }>;
  durationMs: number;
} {
  return { report: message, sources: [], durationMs: 0 };
}

function buildInternalResult(): z.infer<typeof OutputSchema> {
  return {
    mode: 'internal',
    advocate: buildEmptyReport('Internal mode: invoke synthesis-agent with advocate system prompt'),
    skeptic: buildEmptyReport('Internal mode: invoke synthesis-agent with skeptic system prompt'),
    unbiased: buildEmptyReport('Internal mode: invoke synthesis-agent with arbiter system prompt'),
    synthesis: {
      convergence: [
        'Run synthesis-agent 3x with different role prompts to generate convergence analysis',
      ],
      divergence: ['Use advocate/skeptic/arbiter outputs to identify genuine disagreements'],
      informativeTests: [
        'Identify tests that would resolve disagreements between advocate and skeptic',
      ],
      summary:
        'Internal mode: use synthesis-agent with 3 different role prompts for adversarial analysis',
    },
  };
}

function buildPlaceholderSynthesis(): z.infer<typeof SynthesisSchema> {
  return {
    convergence: ['Convergence analysis pending — synthesis-agent will analyze the 3 reports'],
    divergence: ['Divergence analysis pending — synthesis-agent will identify disagreements'],
    informativeTests: [
      'Informative test identification pending — synthesis-agent will recommend discriminating tests',
    ],
    summary:
      'External research complete. The synthesis-agent should now analyze the 3 adversarial reports to produce final convergence/divergence analysis.',
  };
}

/**
 * Adversarial Synthesis Tool — orchestrates the 3-agent adversarial pattern
 * for deep evidence evaluation.
 *
 * External mode: runs 3 parallel Parallel.ai deep research calls
 * (advocate, skeptic, unbiased). This takes 20+ minutes each in ultra mode.
 *
 * Internal mode: returns structured guidance for the orchestrator to invoke
 * synthesis-agent 3 times with different role prompts.
 */
export const adversarialSynthesisTool = createTool({
  id: 'adversarial-synthesis',
  description:
    'Orchestrate 3-agent adversarial analysis of a medical hypothesis. Runs advocate (prove), skeptic (disprove), and unbiased (arbiter) research in parallel. Use external mode for Parallel.ai deep research (20+ min), or internal mode for orchestrator-driven synthesis-agent calls.',
  inputSchema: z.object({
    hypothesis: z.string().describe('The medical hypothesis to evaluate adversarially'),
    patientContext: z
      .string()
      .describe('Relevant patient context including symptoms, findings, and history'),
    mode: z
      .enum(['internal', 'external'])
      .describe(
        'Execution mode: "external" uses Parallel.ai deep research, "internal" uses synthesis-agent via orchestrator',
      ),
    processor: z
      .enum(['ultra', 'ultra2x'])
      .optional()
      .describe('Parallel.ai processor tier (default: ultra). Only used in external mode.'),
  }),
  outputSchema: OutputSchema,
  execute: async (input) => {
    const { hypothesis, patientContext, mode } = input;
    const processor = input.processor ?? 'ultra';

    logger.info('Adversarial synthesis starting', {
      mode,
      processor,
      hypothesisLength: hypothesis.length,
    });

    // Internal mode: return guidance for orchestrator
    if (mode === 'internal') {
      logger.info('Adversarial synthesis: internal mode — returning orchestrator guidance');
      return buildInternalResult();
    }

    // External mode: run 3 parallel Parallel.ai deep research calls
    const advocatePrompt = buildPrompt('advocate', hypothesis, patientContext);
    const skepticPrompt = buildPrompt('skeptic', hypothesis, patientContext);
    const unbiasedPrompt = buildPrompt('unbiased', hypothesis, patientContext);

    logger.info('Adversarial synthesis: launching 3 parallel Parallel.ai research calls', {
      processor,
    });

    const startTime = Date.now();

    const [advocateResult, skepticResult, unbiasedResult] = await Promise.all([
      runDeepResearch(advocatePrompt, { processor }),
      runDeepResearch(skepticPrompt, { processor }),
      runDeepResearch(unbiasedPrompt, { processor }),
    ]);

    const totalDurationMs = Date.now() - startTime;

    // If any result is null, Parallel.ai is unavailable — fall back to internal mode
    if (advocateResult === null || skepticResult === null || unbiasedResult === null) {
      logger.warn(
        'Adversarial synthesis: Parallel.ai unavailable for one or more roles — falling back to internal mode',
        {
          advocateAvailable: advocateResult !== null,
          skepticAvailable: skepticResult !== null,
          unbiasedAvailable: unbiasedResult !== null,
        },
      );
      return buildInternalResult();
    }

    logger.info('Adversarial synthesis: all 3 Parallel.ai research calls complete', {
      totalDurationMs,
    });

    return {
      mode: 'external',
      advocate: {
        report: advocateResult.output,
        sources: advocateResult.sources,
        durationMs: totalDurationMs,
      },
      skeptic: {
        report: skepticResult.output,
        sources: skepticResult.sources,
        durationMs: totalDurationMs,
      },
      unbiased: {
        report: unbiasedResult.output,
        sources: unbiasedResult.sources,
        durationMs: totalDurationMs,
      },
      synthesis: buildPlaceholderSynthesis(),
    };
  },
});
