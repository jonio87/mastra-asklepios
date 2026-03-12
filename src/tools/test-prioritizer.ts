import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';

const testInputSchema = z.object({
  test: z.string().describe('Name of the diagnostic test'),
  targetHypothesis: z.string().describe('Which hypothesis this test discriminates'),
  expectedImpact: z.string().describe('What the result means for hypothesis ranking'),
  urgency: z.enum(['IMMEDIATE', 'SHORT_TERM', 'PARALLEL']).describe('How urgently needed'),
  alreadyDone: z.boolean().optional().describe('Whether already performed'),
  result: z.string().optional().describe('Result if already done'),
  estimatedCostUsd: z.number().min(0).optional().describe('Estimated cost in USD'),
  invasiveness: z
    .number()
    .min(0)
    .max(5)
    .optional()
    .describe('0=non-invasive (blood draw), 3=moderate (biopsy), 5=highly invasive'),
  informationGain: z.number().min(0).max(1).optional().describe('Expected information gain (0-1)'),
  availability: z.enum(['routine', 'specialist', 'reference-lab', 'research-only']).optional(),
  turnaroundDays: z.number().optional().describe('Expected turnaround time in days'),
});

export type PrioritizedTest = z.infer<typeof testInputSchema> & {
  rank: number;
  compositeScore: number;
  rationale: string;
};

type TestInput = z.infer<typeof testInputSchema>;

type ScoredTest = TestInput & {
  compositeScore: number;
  rank: number;
  rationale: string;
};

const urgencyScoreMultipliers: Record<string, number> = {
  immediate: 1,
  short_term: 0.6,
  parallel: 0.3,
};

const AVAILABILITY_SCORES: Record<string, number> = {
  routine: 10,
  specialist: 7,
  'reference-lab': 4,
  'research-only': 1,
};

function computeCompositeScore(
  t: TestInput,
  maxCost: number,
  urgencyWeight: number,
  costWeight: number,
): { compositeScore: number; rationale: string } {
  const infoGain = (t.informationGain ?? 0.5) * 40;
  const invasivenessScore = (1 - (t.invasiveness ?? 2) / 5) * 10;
  const costScore = (1 - (t.estimatedCostUsd ?? 50) / maxCost) * costWeight;
  const urgencyScore = urgencyWeight * (urgencyScoreMultipliers[t.urgency.toLowerCase()] ?? 0.3);
  const availabilityScore = AVAILABILITY_SCORES[t.availability ?? 'research-only'] ?? 1;

  const compositeScore = Math.round(
    Math.min(
      100,
      Math.max(0, infoGain + invasivenessScore + costScore + urgencyScore + availabilityScore),
    ),
  );

  const rationale = [
    `Info gain: ${((t.informationGain ?? 0.5) * 100).toFixed(0)}%`,
    t.estimatedCostUsd !== undefined ? `Cost: $${t.estimatedCostUsd}` : null,
    t.invasiveness !== undefined ? `Invasiveness: ${t.invasiveness}/5` : null,
    `Urgency: ${t.urgency}`,
    t.availability ? `Availability: ${t.availability}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return { compositeScore, rationale };
}

function buildScoredTest(t: TestInput, compositeScore: number, rationale: string): ScoredTest {
  return { ...t, compositeScore, rank: 0, rationale };
}

function identifyCriticalPath(scored: ScoredTest[]): string[] {
  const criticalPath: string[] = [];
  const geneticTests = scored.filter((t) =>
    /\b(WES|WGS|exome|genome|panel|sequencing|genotyp)/i.test(t.test),
  );
  if (geneticTests.length > 0) {
    criticalPath.push('Genetic counseling');
    for (const gt of geneticTests) criticalPath.push(gt.test);
  }
  return criticalPath;
}

function identifyParallelizable(scored: ScoredTest[], criticalPath: string[]): string[][] {
  const parallelizable: string[][] = [];
  const urgencyGroups: Array<'IMMEDIATE' | 'SHORT_TERM'> = ['IMMEDIATE', 'SHORT_TERM'];

  for (const urgency of urgencyGroups) {
    const group = scored
      .filter((t) => t.urgency === urgency && !criticalPath.includes(t.test))
      .map((t) => t.test);
    if (group.length > 1) parallelizable.push(group);
  }

  return parallelizable;
}

function buildOutputTest(t: ScoredTest) {
  return {
    test: t.test,
    targetHypothesis: t.targetHypothesis,
    expectedImpact: t.expectedImpact,
    urgency: t.urgency,
    rank: t.rank,
    compositeScore: t.compositeScore,
    rationale: t.rationale,
    ...(t.estimatedCostUsd !== undefined ? { estimatedCostUsd: t.estimatedCostUsd } : {}),
    ...(t.invasiveness !== undefined ? { invasiveness: t.invasiveness } : {}),
    ...(t.informationGain !== undefined ? { informationGain: t.informationGain } : {}),
    ...(t.availability ? { availability: t.availability } : {}),
    ...(t.turnaroundDays !== undefined ? { turnaroundDays: t.turnaroundDays } : {}),
  };
}

export const testPrioritizerTool = createTool({
  id: 'test-prioritizer',
  description:
    'Prioritize diagnostic tests by composite score (information gain, cost, invasiveness, urgency, availability). Filters out already-done tests and checks Layer 2 for existing results. Groups tests into parallelizable batches and identifies sequential dependencies.',
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    tests: z.array(testInputSchema).describe('Tests to prioritize'),
    budget: z.number().optional().describe('Maximum total budget in USD'),
    urgencyBias: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('0=cost-optimize, 1=speed-optimize (default: 0.5)'),
  }),
  outputSchema: z.object({
    prioritizedTests: z.array(
      z.object({
        test: z.string(),
        targetHypothesis: z.string(),
        expectedImpact: z.string(),
        urgency: z.enum(['IMMEDIATE', 'SHORT_TERM', 'PARALLEL']),
        rank: z.number(),
        compositeScore: z.number().min(0).max(100),
        rationale: z.string(),
        estimatedCostUsd: z.number().optional(),
        invasiveness: z.number().optional(),
        informationGain: z.number().optional(),
        availability: z
          .enum(['routine', 'specialist', 'reference-lab', 'research-only'])
          .optional(),
        turnaroundDays: z.number().optional(),
      }),
    ),
    totalEstimatedCost: z.number(),
    criticalPath: z.array(z.string()).describe('Tests that must be done sequentially'),
    parallelizable: z
      .array(z.array(z.string()))
      .describe('Groups of tests that can run simultaneously'),
    withinBudget: z.boolean(),
  }),
  execute: async (input) => {
    const { patientId, tests, budget, urgencyBias = 0.5 } = input;
    logger.info('Prioritizing diagnostic tests', { patientId, testCount: tests.length, budget });

    // Filter out already-done tests
    const pendingTests = tests.filter((t) => !t.alreadyDone);

    // Check Layer 2 for existing lab results
    const store = getClinicalStore();
    const filteredTests: typeof pendingTests = [];
    for (const test of pendingTests) {
      try {
        const existing = await store.queryLabs({
          patientId,
          testName: `%${test.test}%`,
        });
        if (existing.length > 0) {
          logger.debug(`Test "${test.test}" already has results in Layer 2, skipping`);
          continue;
        }
      } catch {
        // Non-blocking — include test if check fails
      }
      filteredTests.push(test);
    }

    // Compute composite scores
    const maxCost = Math.max(...filteredTests.map((t) => t.estimatedCostUsd ?? 100), 1);
    const urgencyWeight = urgencyBias * 20;
    const costWeight = (1 - urgencyBias) * 20;

    const scored = filteredTests.map((t) => {
      const { compositeScore, rationale } = computeCompositeScore(
        t,
        maxCost,
        urgencyWeight,
        costWeight,
      );
      return buildScoredTest(t, compositeScore, rationale);
    });

    // Sort by urgency group first, then composite score within group
    // biome-ignore lint/style/useNamingConvention: keys match urgency enum values
    const urgencyOrder = { IMMEDIATE: 0, SHORT_TERM: 1, PARALLEL: 2 } as const;
    scored.sort((a, b) => {
      const urgDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      if (urgDiff !== 0) return urgDiff;
      return b.compositeScore - a.compositeScore;
    });

    // Assign ranks
    scored.forEach((t, i) => {
      t.rank = i + 1;
    });

    const criticalPath = identifyCriticalPath(scored);
    const parallelizable = identifyParallelizable(scored, criticalPath);

    const totalEstimatedCost = scored.reduce((sum, t) => sum + (t.estimatedCostUsd ?? 0), 0);
    const withinBudget = budget === undefined || totalEstimatedCost <= budget;

    // If over budget, trim lowest-priority tests
    let prioritizedTests = scored;
    if (budget !== undefined && !withinBudget) {
      let runningCost = 0;
      prioritizedTests = scored.filter((t) => {
        runningCost += t.estimatedCostUsd ?? 0;
        return runningCost <= budget;
      });
    }

    return {
      prioritizedTests: prioritizedTests.map((t) => buildOutputTest(t)),
      totalEstimatedCost,
      criticalPath,
      parallelizable,
      withinBudget,
    };
  },
});
