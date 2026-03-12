import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { specialistInputSchema } from '../schemas/diagnostic-synthesis.js';
import { logger } from '../utils/logger.js';

/**
 * Specialist Input Collection Tool
 *
 * Accepts structured specialist findings and detects model-breaking inputs
 * (specialist contradicts high-confidence hypothesis).
 *
 * Used in Stage 8 of the 9-stage diagnostic flow.
 */
export const specialistInputTool = createTool({
  id: 'specialist-input',
  description:
    'Collect structured specialist input including physical exam findings, clinical impression, hypothesis agreement/disagreement, and detect model-breaking findings that require re-synthesis.',
  inputSchema: specialistInputSchema,
  outputSchema: z.object({
    accepted: z.boolean(),
    modelBreaking: z.boolean(),
    modelBreakingDetail: z.string().optional(),
    summary: z.string(),
    recommendedAction: z.enum(['proceed-to-stage-9', 'return-to-stage-7', 'return-to-stage-4']),
  }),
  execute: async (input) => {
    logger.info('Specialist input received', {
      specialistName: input.specialistName,
      specialty: input.specialty,
      modelBreaking: input.modelBreaking,
    });

    const hasModelBreaking = input.modelBreaking === true;

    // Detect model-breaking: specialist contradicts high-confidence hypothesis
    // or provides findings that fundamentally change the diagnostic picture
    let recommendedAction: 'proceed-to-stage-9' | 'return-to-stage-7' | 'return-to-stage-4' =
      'proceed-to-stage-9';

    if (hasModelBreaking && input.modelBreakingDetail) {
      // Check severity: if model-breaking findings suggest entirely new research
      // direction, route to Stage 4; otherwise re-synthesize at Stage 7
      const detail = input.modelBreakingDetail.toLowerCase();
      const needsNewResearch =
        detail.includes('new diagnosis') ||
        detail.includes('previously unknown') ||
        detail.includes('entirely different') ||
        detail.includes('missed finding') ||
        detail.includes('new pathology');

      recommendedAction = needsNewResearch ? 'return-to-stage-4' : 'return-to-stage-7';
    }

    // Build disagreement summary from hypothesis verdicts
    const disagreements = input.hypothesisAgreement
      .filter((h) => h.verdict === 'disagree')
      .map((h) => `${h.hypothesisName}: ${h.reasoning}`);

    const summary = [
      `Specialist: ${input.specialistName} (${input.specialty})`,
      input.institution ? `Institution: ${input.institution}` : null,
      `Date: ${input.date}`,
      `Physical Exam: ${input.physicalExamination.join('; ')}`,
      `Clinical Impression: ${input.clinicalImpression}`,
      `Hypothesis Agreements: ${input.hypothesisAgreement.filter((h) => h.verdict === 'agree').length}/${input.hypothesisAgreement.length}`,
      disagreements.length > 0 ? `Disagreements: ${disagreements.join('; ')}` : null,
      input.recommendedTests ? `Recommended Tests: ${input.recommendedTests.join(', ')}` : null,
      input.recommendedTreatments
        ? `Recommended Treatments: ${input.recommendedTreatments.join(', ')}`
        : null,
      hasModelBreaking
        ? `MODEL-BREAKING: ${input.modelBreakingDetail ?? 'No detail provided'}`
        : 'No model-breaking findings',
    ]
      .filter(Boolean)
      .join('\n');

    logger.info('Specialist input processed', {
      modelBreaking: hasModelBreaking,
      recommendedAction,
      disagreementCount: disagreements.length,
    });

    return {
      accepted: true,
      modelBreaking: hasModelBreaking,
      ...(input.modelBreakingDetail ? { modelBreakingDetail: input.modelBreakingDetail } : {}),
      summary,
      recommendedAction,
    };
  },
});
