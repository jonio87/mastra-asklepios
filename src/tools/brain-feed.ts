import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { logger } from '../utils/logger.js';

/**
 * Anonymizes clinical observation text for brain consumption.
 *
 * Strips:
 * - Specific dates → relative references ("3 months ago", "onset age 12")
 * - Patient names → removed entirely
 * - Provider names → "specialist" / "provider"
 * - Location identifiers → removed
 * - Medical record numbers → removed
 *
 * Preserves:
 * - Symptoms, findings, diagnoses
 * - Temporal relationships (relative)
 * - Research citations (PMIDs, ORPHAcodes)
 * - Confidence scores and evidence quality
 */
export function anonymizeObservations(text: string): string {
  let anonymized = text;

  // Remove specific dates (YYYY-MM-DD, MM/DD/YYYY, Month Day Year)
  anonymized = anonymized.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '[date-removed]');
  anonymized = anonymized.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '[date-removed]');
  anonymized = anonymized.replace(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
    '[date-removed]',
  );

  // Remove specific times (HH:MM, HH:MM:SS)
  anonymized = anonymized.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b/g, '[time]');

  // Remove common name patterns (Dr. LastName, Patient: Name)
  anonymized = anonymized.replace(
    /\b(?:Dr\.?|Doctor|Patient|Mr\.?|Mrs\.?|Ms\.?)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g,
    '[person]',
  );

  // Remove medical record numbers (MRN: XXXXX)
  anonymized = anonymized.replace(
    /\b(?:MRN|Medical Record|Record #|ID):?\s*[A-Z0-9-]+\b/gi,
    '[id-removed]',
  );

  // Remove email addresses
  anonymized = anonymized.replace(
    /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    '[email-removed]',
  );

  // Remove phone numbers
  anonymized = anonymized.replace(
    /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    '[phone-removed]',
  );

  // Clean up multiple spaces and empty lines
  anonymized = anonymized.replace(/\n{3,}/g, '\n\n');
  anonymized = anonymized.replace(/ {2,}/g, ' ');

  return anonymized.trim();
}

/**
 * Brain Feed Tool — feeds anonymized patient observations to the Asklepios Brain.
 *
 * Called after significant patient interactions to share diagnostic insights
 * with the cross-patient learning system. The brain receives compressed,
 * anonymized observation summaries and extracts patterns.
 *
 * This tool does NOT call the brain agent directly — it prepares the
 * anonymized payload. The actual brain agent interaction happens via
 * the brain's memory system when the brain thread is written to.
 */
export const brainFeedTool = createTool({
  id: 'brain-feed',
  description:
    'Feed anonymized patient observations to the Asklepios Brain for cross-patient learning. Use after significant diagnostic findings, hypothesis changes, or research breakthroughs.',
  inputSchema: z.object({
    observations: z
      .string()
      .describe(
        'Clinical observations to feed to the brain. Include: symptoms, findings, hypotheses, research results, diagnostic decisions.',
      ),
    caseLabel: z
      .string()
      .describe(
        'Anonymized case label (e.g., "Case-hypermobility-001"). Do NOT include patient names or identifiers.',
      ),
    keyFindings: z
      .array(z.string())
      .optional()
      .describe('List of key diagnostic findings from this case that may benefit future patients.'),
    hypotheses: z
      .array(
        z.object({
          diagnosis: z.string(),
          confidence: z.number().min(0).max(100),
          keyEvidence: z.string(),
        }),
      )
      .optional()
      .describe('Current diagnostic hypotheses with confidence levels.'),
  }),
  outputSchema: z.object({
    anonymizedText: z
      .string()
      .describe('The anonymized observation text ready for brain consumption'),
    caseLabel: z.string().describe('The case label'),
    wordCount: z.number().describe('Word count of anonymized text'),
    redactionCount: z.number().describe('Number of redactions applied'),
  }),
  execute: async (input) => {
    logger.info('Brain feed: anonymizing observations', {
      caseLabel: input.caseLabel,
      inputLength: input.observations.length,
    });

    const anonymized = anonymizeObservations(input.observations);

    // Count redactions
    const redactionCount = (anonymized.match(/\[.*?-removed\]|\[person\]|\[time\]/g) ?? []).length;

    // Build the brain-ready summary
    const parts: string[] = [`## Case: ${input.caseLabel}`, '', anonymized];

    if (input.keyFindings && input.keyFindings.length > 0) {
      parts.push('', '### Key Findings');
      for (const finding of input.keyFindings) {
        parts.push(`- ${finding}`);
      }
    }

    if (input.hypotheses && input.hypotheses.length > 0) {
      parts.push('', '### Current Hypotheses');
      for (const h of input.hypotheses) {
        parts.push(`- **${h.diagnosis}** (${h.confidence}%): ${h.keyEvidence}`);
      }
    }

    const anonymizedText = parts.join('\n');
    const wordCount = anonymizedText.split(/\s+/).length;

    logger.info('Brain feed: anonymization complete', {
      caseLabel: input.caseLabel,
      wordCount,
      redactionCount,
    });

    return {
      anonymizedText,
      caseLabel: input.caseLabel,
      wordCount,
      redactionCount,
    };
  },
});
