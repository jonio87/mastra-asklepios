import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { directionEnum } from '../schemas/research-record.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';

/**
 * Evidence Linking Tool — connects research findings and clinical records
 * to diagnostic hypotheses with directional relationship tracking.
 *
 * Supports two actions:
 * - "link": Create a new evidence link between a hypothesis and finding/clinical record
 * - "query": Retrieve all evidence links for a hypothesis
 */

const clinicalRecordTypeEnum = z.enum([
  'lab-result',
  'consultation',
  'contradiction',
  'treatment-trial',
  'patient-report',
  'agent-learning',
]);

const tierEnum = z.enum(['T1', 'T2', 'T3']);

const evidenceLinkInputSchema = z.object({
  action: z
    .enum(['link', 'query'])
    .describe(
      '"link" to create a new evidence link, "query" to retrieve evidence for a hypothesis',
    ),
  patientId: z.string().describe('Patient resource ID'),
  hypothesisId: z.string().describe('Hypothesis ID to link evidence to or query evidence for'),
  // Link-specific fields (required when action = "link")
  findingId: z
    .string()
    .optional()
    .describe('(link) Research finding ID — provide this OR clinicalRecordId'),
  clinicalRecordId: z
    .string()
    .optional()
    .describe('(link) Clinical record ID — provide this OR findingId'),
  clinicalRecordType: clinicalRecordTypeEnum.optional().describe('(link) Type of clinical record'),
  direction: directionEnum
    .optional()
    .describe('(link) Relationship direction: supporting, contradicting, neutral, inconclusive'),
  claim: z
    .string()
    .optional()
    .describe('(link) Evidence claim (e.g., "PR3-ANCA positive supports GPA diagnosis")'),
  confidence: z.number().min(0).max(1).optional().describe('(link) Confidence in the link 0.0-1.0'),
  tier: tierEnum.optional().describe('(link) Evidence tier T1/T2/T3'),
  notes: z.string().optional().describe('(link) Additional notes about this evidence link'),
});

function generateId(): string {
  return `elink-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayDate(): string {
  return new Date().toISOString().split('T')[0] ?? '';
}

export const evidenceLinkTool = createTool({
  id: 'evidence-link',
  description: `Link evidence to diagnostic hypotheses or query existing evidence links.
- action "link": Connect a research finding or clinical record to a hypothesis with a directional claim
- action "query": Retrieve all evidence linked to a hypothesis (supporting + contradicting + neutral)`,
  inputSchema: evidenceLinkInputSchema,
  outputSchema: z.object({
    data: z.unknown().describe('Link result or evidence list'),
  }),
  execute: async (input) => {
    const store = getClinicalStore();

    if (input.action === 'query') {
      logger.debug(`evidenceLink(query) for hypothesis ${input.hypothesisId}`);
      const result = await store.getHypothesisWithEvidence(input.hypothesisId);
      if (!result) {
        return { data: { error: `Hypothesis ${input.hypothesisId} not found` } };
      }

      const supporting = result.links.filter((l) => l.direction === 'supporting');
      const contradicting = result.links.filter((l) => l.direction === 'contradicting');
      const neutral = result.links.filter(
        (l) => l.direction === 'neutral' || l.direction === 'inconclusive',
      );

      return {
        data: {
          hypothesis: {
            id: result.hypothesis.id,
            name: result.hypothesis.name,
            probabilityLow: result.hypothesis.probabilityLow,
            probabilityHigh: result.hypothesis.probabilityHigh,
            certaintyLevel: result.hypothesis.certaintyLevel,
            evidenceTier: result.hypothesis.evidenceTier,
          },
          evidence: {
            total: result.links.length,
            supporting: supporting.length,
            contradicting: contradicting.length,
            neutral: neutral.length,
            links: result.links,
          },
        },
      };
    }

    // action === 'link'
    if (!input.direction) {
      return { data: { error: 'direction is required when action is "link"' } };
    }
    if (!input.claim) {
      return { data: { error: 'claim is required when action is "link"' } };
    }
    if (!(input.findingId || input.clinicalRecordId)) {
      return { data: { error: 'Either findingId or clinicalRecordId is required' } };
    }

    const id = generateId();
    logger.debug(
      `evidenceLink(link) ${id}: ${input.direction} evidence for hypothesis ${input.hypothesisId}`,
    );

    const link: {
      id: string;
      patientId: string;
      hypothesisId: string;
      direction: z.infer<typeof directionEnum>;
      claim: string;
      date: string;
      findingId?: string;
      clinicalRecordId?: string;
      clinicalRecordType?: z.infer<typeof clinicalRecordTypeEnum>;
      confidence?: number;
      tier?: 'T1' | 'T2' | 'T3';
      notes?: string;
    } = {
      id,
      patientId: input.patientId,
      hypothesisId: input.hypothesisId,
      direction: input.direction,
      claim: input.claim,
      date: todayDate(),
    };
    if (input.findingId) link.findingId = input.findingId;
    if (input.clinicalRecordId) link.clinicalRecordId = input.clinicalRecordId;
    if (input.clinicalRecordType) link.clinicalRecordType = input.clinicalRecordType;
    if (input.confidence !== undefined) link.confidence = input.confidence;
    if (input.tier) link.tier = input.tier;
    if (input.notes) link.notes = input.notes;

    await store.addEvidenceLink(link);

    return {
      data: {
        success: true,
        id,
        hypothesisId: input.hypothesisId,
        direction: input.direction,
        claim: input.claim,
      },
    };
  },
});
