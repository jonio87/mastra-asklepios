import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';

const brainPatternSchema = z.object({
  pattern: z.string().describe('The diagnostic pattern or insight'),
  relevance: z.number().min(0).max(1).describe('Relevance score (0-1) based on symptom overlap'),
  category: z
    .enum([
      'diagnostic-shortcut',
      'common-misdiagnosis',
      'key-differentiator',
      'research-tip',
      'temporal-pattern',
      'phenotype-genotype',
    ])
    .describe('Type of pattern'),
  supportingCases: z.number().describe('Number of cases that support this pattern'),
});

export type BrainPattern = z.infer<typeof brainPatternSchema>;

/**
 * Brain Recall Tool — queries the Asklepios Brain for cross-patient patterns.
 *
 * Called before deep research to check if the brain has seen similar
 * phenotype presentations before. Returns diagnostic shortcuts,
 * common misdiagnoses, key differentiators, and research tips.
 *
 * In the full implementation, this will call brainAgent.generate()
 * with the patient's symptoms and HPO terms. For now, it returns
 * a structured query result that the agent can use to guide research.
 */
export const brainRecallTool = createTool({
  id: 'brain-recall',
  description:
    'Query the Asklepios Brain for cross-patient diagnostic patterns. Use before deep research to leverage insights from previous cases. Input the current patient symptoms and HPO terms.',
  inputSchema: z.object({
    symptoms: z
      .array(z.string())
      .describe('Current patient symptoms to match against brain patterns'),
    hpoTerms: z
      .array(z.string())
      .optional()
      .describe('HPO terms for more precise pattern matching'),
    currentHypotheses: z
      .array(z.string())
      .optional()
      .describe('Current diagnostic hypotheses to check against brain knowledge'),
  }),
  outputSchema: z.object({
    patterns: z
      .array(brainPatternSchema)
      .describe('Matching cross-patient patterns ordered by relevance'),
    totalCasesInBrain: z.number().describe('Total number of cases the brain has learned from'),
    querySymptoms: z.array(z.string()).describe('The symptoms used for the query'),
    recommendation: z
      .string()
      .describe('Brain recommendation for the current case based on patterns'),
  }),
  execute: async (input) => {
    logger.info('Brain recall: querying cross-patient patterns', {
      symptomCount: input.symptoms.length,
      hpoTermCount: input.hpoTerms?.length ?? 0,
    });

    const store = getClinicalStore();

    // Query brain patterns matching the patient's symptoms
    const patterns = await store.queryBrainPatterns({
      symptoms: input.symptoms,
      hpoTerms: input.hpoTerms,
    });

    const totalCases = await store.getBrainCaseCount();

    // Map stored patterns to output format
    const outputPatterns = patterns.map((p) => ({
      pattern: p.pattern,
      relevance: p.confidence,
      category: p.category,
      supportingCases: p.supportingCases,
    }));

    // Build recommendation
    let recommendation: string;
    if (outputPatterns.length === 0) {
      recommendation =
        totalCases > 0
          ? `No matching patterns found for: ${input.symptoms.slice(0, 3).join(', ')}. Brain has ${totalCases} cases but none match this presentation. Proceed with standard research workflow.`
          : 'Brain has no cases yet. Proceed with standard research workflow. Feed cases after diagnostic conclusions to build the pattern database.';
    } else {
      const topPattern = outputPatterns[0];
      const shortcutCount = outputPatterns.filter(
        (p) => p.category === 'diagnostic-shortcut',
      ).length;
      const misdiagCount = outputPatterns.filter(
        (p) => p.category === 'common-misdiagnosis',
      ).length;

      const parts: string[] = [
        `Found ${outputPatterns.length} matching patterns from ${totalCases} cases.`,
      ];
      if (shortcutCount > 0) parts.push(`${shortcutCount} diagnostic shortcut(s) available.`);
      if (misdiagCount > 0) parts.push(`${misdiagCount} common misdiagnosis warning(s).`);
      if (topPattern) parts.push(`Top pattern: ${topPattern.pattern}`);
      recommendation = parts.join(' ');
    }

    logger.info('Brain recall: query complete', {
      patternsFound: outputPatterns.length,
      totalCases,
    });

    return {
      patterns: outputPatterns,
      totalCasesInBrain: totalCases,
      querySymptoms: input.symptoms,
      recommendation,
    };
  },
});
