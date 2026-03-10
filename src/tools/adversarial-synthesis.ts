import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { diagnosticSynthesisSchema } from '../schemas/diagnostic-synthesis.js';
import { getClinicalStore } from '../storage/clinical-store.js';
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

const OutputSchema = z.object({
  mode: z.string().describe('Execution mode used: internal or external'),
  advocate: RoleReportSchema.describe(
    'Report from the advocate perspective (proving the hypothesis)',
  ),
  skeptic: RoleReportSchema.describe(
    'Report from the skeptic perspective (challenging the hypothesis)',
  ),
  unbiased: RoleReportSchema.describe('Report from the unbiased arbiter perspective'),
  diagnosticSynthesis: diagnosticSynthesisSchema
    .optional()
    .describe(
      'Structured diagnostic synthesis — populated in internal mode, placeholder in external (synthesis-agent fills it)',
    ),
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
    advocate: buildEmptyReport(
      'Internal mode: invoke synthesis-agent with mode="advocate" — find strongest evidence FOR each hypothesis',
    ),
    skeptic: buildEmptyReport(
      'Internal mode: invoke synthesis-agent with mode="skeptic" — find strongest evidence AGAINST each hypothesis',
    ),
    unbiased: buildEmptyReport(
      'Internal mode: invoke synthesis-agent with mode="arbiter" — assign probability ranges from advocate+skeptic outputs',
    ),
    diagnosticSynthesis: {
      hypotheses: [],
      convergencePoints: [
        'Pending: run synthesis-agent 3x with advocate/skeptic/arbiter modes, then populate',
      ],
      divergencePoints: [],
      mostInformativeTests: [],
      unresolvedQuestions: [
        'Invoke synthesis-agent with mode="advocate", then mode="skeptic", then mode="arbiter" passing both outputs',
      ],
    },
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

    const externalResult = {
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
      diagnosticSynthesis: {
        hypotheses: [],
        convergencePoints: [
          'External mode: synthesis-agent should analyze advocate+skeptic+unbiased reports and populate structured synthesis',
        ],
        divergencePoints: [],
        mostInformativeTests: [],
        unresolvedQuestions: [
          'Invoke synthesis-agent with mode="arbiter" passing the three reports above to produce structured diagnostic synthesis',
        ],
      },
    };

    // Auto-capture: persist query record for synthesis (fire-and-forget)
    persistSynthesisQuery(hypothesis, totalDurationMs).catch((err: unknown) => {
      logger.warn('Auto-capture of synthesis query failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return externalResult;
  },
});

/** Auto-persist a research query record for the adversarial synthesis execution. */
async function persistSynthesisQuery(hypothesis: string, durationMs: number): Promise<void> {
  const store = getClinicalStore();
  const today = new Date().toISOString().split('T')[0] ?? '';

  await store.addResearchQuery({
    id: `rquery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    patientId: 'unknown',
    query: `Adversarial synthesis: ${hypothesis}`,
    toolUsed: 'adversarialSynthesis',
    date: today,
    durationMs,
    resultCount: 3,
    stage: 7,
  });

  logger.info('Auto-captured adversarial synthesis query');
}
