import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getDocumentStore } from '../knowledge/document-store.js';
import { vectorStore } from '../memory.js';
import type { ClinicalStore } from '../storage/clinical-store.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { createEmbedder } from '../utils/embedder.js';
import { logger } from '../utils/logger.js';

// ─── Schemas ──────────────────────────────────────────────────────────────

const claimTypeEnum = z.enum(['test-never-done', 'finding-absent', 'treatment-never-tried']);

const contradictingEvidenceSchema = z.object({
  layer: z.string().describe('Which data layer the evidence came from (e.g. "Layer 2 - Labs")'),
  source: z.string().describe('Specific source identifier (test name, medication, document title)'),
  summary: z.string().describe('Brief description of the contradicting evidence'),
});

const confidenceEnum = z.enum(['high', 'moderate', 'low']);

const inputSchema = z.object({
  patientId: z.string().describe('The patient to check'),
  claim: z.string().describe('The claim to verify (e.g. "homocysteine was never measured")'),
  claimType: claimTypeEnum.describe('Category of the negative claim'),
  searchTerms: z
    .array(z.string())
    .describe('Terms to search for in Layer 2 and Layer 3 data stores'),
});

const outputSchema = z.object({
  verified: z
    .boolean()
    .describe('True if absence is confirmed, false if contradicting evidence found'),
  contradictingEvidence: z
    .array(contradictingEvidenceSchema)
    .describe('Evidence that contradicts the negative claim'),
  searchedLayers: z.array(z.string()).describe('Which data layers were searched'),
  confidence: confidenceEnum.describe('Confidence level based on how many layers were searched'),
});

// ─── Helpers ──────────────────────────────────────────────────────────────

interface ContradictingEvidence {
  layer: string;
  source: string;
  summary: string;
}

/**
 * Search Layer 2 labs for matching test names using LIKE queries.
 */
async function searchLabs(
  store: ClinicalStore,
  patientId: string,
  searchTerms: string[],
): Promise<ContradictingEvidence[]> {
  const evidence: ContradictingEvidence[] = [];

  for (const term of searchTerms) {
    const labs = await store.queryLabs({ patientId, testName: `%${term}%` });
    for (const lab of labs) {
      evidence.push({
        layer: 'Layer 2 - Labs',
        source: lab.testName,
        summary: `Lab result found: ${lab.testName} = ${String(lab.value)} ${lab.unit} on ${lab.date}${lab.flag ? ` (${lab.flag})` : ''}`,
      });
    }
  }

  return evidence;
}

/**
 * Search Layer 2 treatments and filter by medication name matching search terms.
 */
async function searchTreatments(
  store: ClinicalStore,
  patientId: string,
  searchTerms: string[],
): Promise<ContradictingEvidence[]> {
  const evidence: ContradictingEvidence[] = [];
  const treatments = await store.queryTreatments({ patientId });
  const lowerTerms = searchTerms.map((t) => t.toLowerCase());

  for (const treatment of treatments) {
    const medLower = treatment.medication.toLowerCase();
    const matched = lowerTerms.some((term) => medLower.includes(term));
    if (matched) {
      evidence.push({
        layer: 'Layer 2 - Treatments',
        source: treatment.medication,
        summary: `Treatment found: ${treatment.medication}${treatment.dosage ? ` (${treatment.dosage})` : ''}, efficacy: ${treatment.efficacy}${treatment.startDate ? `, started ${treatment.startDate}` : ''}`,
      });
    }
  }

  return evidence;
}

/**
 * Search Layer 2 research findings and filter by title/summary matching search terms.
 */
async function searchFindings(
  store: ClinicalStore,
  patientId: string,
  searchTerms: string[],
): Promise<ContradictingEvidence[]> {
  const evidence: ContradictingEvidence[] = [];
  const findings = await store.queryFindings({ patientId });
  const lowerTerms = searchTerms.map((t) => t.toLowerCase());

  for (const finding of findings) {
    const titleLower = finding.title.toLowerCase();
    const summaryLower = finding.summary.toLowerCase();
    const matched = lowerTerms.some(
      (term) => titleLower.includes(term) || summaryLower.includes(term),
    );
    if (matched) {
      evidence.push({
        layer: 'Layer 2 - Findings',
        source: finding.title,
        summary: `Finding matched: "${finding.title}" — ${finding.summary.slice(0, 150)}${finding.summary.length > 150 ? '…' : ''}`,
      });
    }
  }

  return evidence;
}

/**
 * Search Layer 3 document knowledge base using semantic search for each term.
 */
async function searchDocumentKb(
  patientId: string,
  searchTerms: string[],
): Promise<ContradictingEvidence[]> {
  const embedder = createEmbedder();
  if (!embedder) {
    logger.debug('Claim verifier: Layer 3 search skipped — no embedder available');
    return [];
  }

  const store = getDocumentStore(vectorStore, embedder);
  const evidence: ContradictingEvidence[] = [];
  const seenTexts = new Set<string>();

  for (const term of searchTerms) {
    const chunks = await store.queryDocuments(term, { patientId, topK: 3 });
    for (const chunk of chunks) {
      // Deduplicate by chunk text prefix to avoid reporting the same chunk multiple times
      const textKey = chunk.text.slice(0, 100);
      if (seenTexts.has(textKey)) continue;
      seenTexts.add(textKey);

      const sourceLabel =
        chunk.metadata.title ?? chunk.metadata.source ?? chunk.metadata.documentType;
      evidence.push({
        layer: 'Layer 3 - Documents',
        source: sourceLabel,
        summary: `Document chunk matched: "${chunk.text.slice(0, 200)}${chunk.text.length > 200 ? '…' : ''}"${chunk.score !== undefined ? ` (similarity: ${chunk.score.toFixed(3)})` : ''}`,
      });
    }
  }

  return evidence;
}

/**
 * Determine confidence based on how many layers were successfully searched.
 */
function computeConfidence(layerCount: number): 'high' | 'moderate' | 'low' {
  if (layerCount >= 3) return 'high';
  if (layerCount === 2) return 'moderate';
  return 'low';
}

// ─── Tool ─────────────────────────────────────────────────────────────────

/**
 * Claim Verifier — verifies negative claims (e.g. "test X was never done")
 * against the patient's clinical data before agents can assert absence.
 *
 * Searches Layer 2 (structured clinical data) and Layer 3 (document KB)
 * to find any contradicting evidence. If evidence is found, the claim is
 * NOT verified and the contradicting evidence is returned.
 */
export const claimVerifierTool = createTool({
  id: 'claim-verifier',
  description: `Verify a negative clinical claim (e.g. "test X was never done", "treatment Y was never tried")
against the patient's stored data. Searches Layer 2 (labs, treatments, findings) and Layer 3
(document knowledge base) for contradicting evidence. Use this BEFORE asserting that something
was never done or is absent from the record.

Returns verified=true only if NO contradicting evidence is found across all searched layers.`,
  inputSchema,
  outputSchema,
  execute: async (input) => {
    logger.info('Claim verifier: checking claim', {
      patientId: input.patientId,
      claim: input.claim,
      claimType: input.claimType,
      searchTerms: input.searchTerms,
    });

    const store = getClinicalStore();
    const allEvidence: ContradictingEvidence[] = [];
    const searchedLayers: string[] = [];

    // ── Layer 2 queries based on claim type ──────────────────────────

    try {
      if (input.claimType === 'test-never-done') {
        const labEvidence = await searchLabs(store, input.patientId, input.searchTerms);
        allEvidence.push(...labEvidence);
        searchedLayers.push('Layer 2 - Labs');
      }

      if (input.claimType === 'treatment-never-tried') {
        const treatmentEvidence = await searchTreatments(store, input.patientId, input.searchTerms);
        allEvidence.push(...treatmentEvidence);
        searchedLayers.push('Layer 2 - Treatments');
      }

      if (input.claimType === 'finding-absent') {
        const findingEvidence = await searchFindings(store, input.patientId, input.searchTerms);
        allEvidence.push(...findingEvidence);
        searchedLayers.push('Layer 2 - Findings');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Claim verifier: Layer 2 query failed', { error: message });
    }

    // ── Layer 3 document KB (all claim types) ────────────────────────

    try {
      const docEvidence = await searchDocumentKb(input.patientId, input.searchTerms);
      allEvidence.push(...docEvidence);
      if (docEvidence.length > 0 || createEmbedder() !== null) {
        searchedLayers.push('Layer 3 - Documents');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Claim verifier: Layer 3 query failed', { error: message });
    }

    // ── Compute result ───────────────────────────────────────────────

    const verified = allEvidence.length === 0;
    const confidence = computeConfidence(searchedLayers.length);

    logger.info('Claim verifier: result', {
      claim: input.claim,
      verified,
      contradictingCount: allEvidence.length,
      searchedLayers,
      confidence,
    });

    return {
      verified,
      contradictingEvidence: allEvidence,
      searchedLayers,
      confidence,
    };
  },
});
