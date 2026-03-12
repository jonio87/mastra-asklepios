import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';
import { buildPatientContext } from '../utils/patient-context.js';

const tierASchema = z.object({
  patientId: z.string(),
  demographics: z.object({
    age: z.string().optional(),
    sex: z.string().optional(),
    keyContext: z.string().optional(),
  }),
  activeConcerns: z.array(
    z.object({
      concern: z.string(),
      priority: z.string(),
      since: z.string().optional(),
    }),
  ),
  currentHypotheses: z.array(
    z.object({
      name: z.string(),
      confidenceRange: z.string(),
      certaintyLevel: z.string(),
      keyEvidence: z.string(),
    }),
  ),
  criticalFindings: z.array(z.string()),
  dataCompleteness: z.object({
    labCount: z.number(),
    consultationCount: z.number(),
    treatmentCount: z.number(),
    contradictionCount: z.number(),
    reportCount: z.number(),
    hasResearch: z.boolean(),
  }),
  researchState: z.object({
    findingCount: z.number(),
    hypothesisCount: z.number(),
    latestResearchDate: z.string().optional(),
    topSources: z.array(
      z.object({
        source: z.string(),
        count: z.number(),
      }),
    ),
  }),
  treatmentLandscape: z.object({
    totalTrials: z.number(),
    effectiveCount: z.number(),
    ineffectiveCount: z.number(),
    activeCount: z.number(),
    drugClassesTried: z.array(z.string()),
  }),
});

const tierBSchema = z.object({
  labTrends: z.array(
    z.object({
      testName: z.string(),
      direction: z.string(),
      rateOfChange: z.number().optional(),
      clinicalNote: z.string().optional(),
      latestValue: z.string(),
      latestDate: z.string(),
      dataPoints: z.number(),
    }),
  ),
  temporalMap: z.array(
    z.object({
      date: z.string(),
      event: z.string(),
      category: z.string(),
      significance: z.string(),
    }),
  ),
  hypothesisTimelines: z.array(
    z.object({
      name: z.string(),
      versionCount: z.number(),
      currentConfidence: z.string(),
      directionChanges: z.number(),
      trajectory: z.string(),
    }),
  ),
  unresolvedContradictions: z.array(
    z.object({
      finding1: z.string(),
      finding2: z.string(),
      diagnosticImpact: z.string().optional(),
      resolutionPlan: z.string().optional(),
    }),
  ),
  researchAudit: z.object({
    totalQueries: z.number(),
    totalFindings: z.number(),
    evidenceLinkCount: z.number(),
    gapAreas: z.array(z.string()),
    recentFindings: z.array(
      z.object({
        title: z.string(),
        source: z.string(),
        relevance: z.number().optional(),
        date: z.string(),
      }),
    ),
  }),
  recentConsultations: z.array(
    z.object({
      specialty: z.string(),
      date: z.string(),
      conclusions: z.string().optional(),
      conclusionsStatus: z.string(),
    }),
  ),
});

export const patientContextTool = createTool({
  id: 'patient-context',
  description:
    'Build a comprehensive patient context from Layer 2 clinical data. Returns Tier A (compact ~2K tokens for working memory) and optionally Tier B (expanded ~8K tokens for deep research planning).',
  inputSchema: z.object({
    patientId: z.string().describe('Patient identifier'),
    includeTierB: z
      .boolean()
      .default(true)
      .describe(
        'Include expanded Tier B context (lab trends, temporal map, hypothesis timelines, research audit). Set to false for compact context only.',
      ),
  }),
  outputSchema: z.object({
    tierA: tierASchema,
    tierB: tierBSchema.optional(),
    generatedAt: z.string(),
    tokenEstimate: z.object({ tierA: z.number(), tierB: z.number() }),
  }),
  execute: async ({ patientId, includeTierB }) => {
    logger.info('Building patient context via tool', { patientId, includeTierB });

    const store = getClinicalStore();
    const patientContext = await buildPatientContext(store, patientId);

    if (!includeTierB) {
      const { tierB: _tierB, ...rest } = patientContext;
      return rest;
    }

    return patientContext;
  },
});
