/**
 * Clinical Findings Extractor — two-pass extraction + 4-tier code assignment.
 *
 * Pass 1 (extractFinding): LLM extracts the primary clinical entity as
 *   plain English text — NO codes in the prompt to prevent hallucination.
 *
 * Pass 2 (assignFindingCodes): 4-tier fallback for SNOMED code assignment:
 *   1. Static map lookup (confidence 1.0)
 *   2. Embedding semantic search (confidence 0.85–0.95)
 *   3. LLM code assignment with validation (confidence from model)
 *   4. Return undefined if all tiers fail
 *
 * ICD-10 assignment: crosswalk from SNOMED (preferred) or direct lookup.
 *
 * The backward-compatible extractClinicalFindings() wrapper orchestrates
 * both passes and returns the same interface existing callers depend on.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { translateCode } from '../terminology/crosswalk-service.js';
import { SYSTEM_ICD10, SYSTEM_SNOMED } from '../terminology/terminology-service.js';
import { anthropic } from '../utils/anthropic-provider.js';
import { logger } from '../utils/logger.js';
import { searchIcd10ByEmbedding } from './icd10-embedding-search.js';
import { getIcd10Code } from './icd10-normalizer.js';
import { searchSnomedByEmbedding } from './snomed-embedding-search.js';
import { getSnomedFindingCode } from './snomed-findings-normalizer.js';

// ── Public types ──────────────────────────────────────────────────────

/** Backward-compatible result from extractClinicalFindings(). */
export interface ExtractedFinding {
  findingName: string;
  snomedCode: string;
  confidence: number;
  /** ICD-10 code if available (new in v3). */
  icd10Code?: string;
  /** How each code was assigned (new in v3). */
  snomedSource?: CodeSource;
  icd10Source?: CodeSource;
}

/** Pass 1 result: extracted clinical entity without codes. */
export interface ExtractedEntity {
  findingName: string;
  category: 'diagnosis' | 'symptom' | 'procedure' | 'observation';
  severity?: string;
  bodyRegion?: string;
  confidence: number;
}

/** How a code was assigned. */
export type CodeSource = 'static-map' | 'embedding' | 'crosswalk' | 'llm';

/** Pass 2 result: assigned terminology codes. */
export interface AssignedCodes {
  snomedCode?: string;
  snomedSource?: CodeSource;
  icd10Code?: string;
  icd10Source?: CodeSource;
  confidence: number;
}

// ── Zod schemas ───────────────────────────────────────────────────────

const entitySchema = z.object({
  findingName: z
    .string()
    .describe('The primary clinical diagnosis or finding in standard English medical terminology.'),
  category: z
    .enum(['diagnosis', 'symptom', 'procedure', 'observation'])
    .describe('Category of the extracted entity.'),
  severity: z
    .string()
    .optional()
    .describe('Severity qualifier if mentioned (e.g., "mild", "severe", "chronic").'),
  bodyRegion: z
    .string()
    .optional()
    .describe('Body region if specified (e.g., "cervical spine", "left knee").'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Confidence in the extraction (0.0-1.0). Use 0.9+ only when diagnosis is explicitly stated. Use < 0.3 for procedural text with no diagnosis.',
    ),
});

const snomedCodeSchema = z.object({
  snomedCode: z
    .string()
    .regex(/^\d{6,18}$/)
    .nullable()
    .describe('SNOMED CT concept ID (6-18 digit number). Return null if uncertain.'),
  confidence: z.number().min(0).max(1).describe('Confidence in the code assignment (0.0-1.0).'),
});

// ── Pass 1: Entity extraction (no codes) ──────────────────────────────

/**
 * Extract the primary clinical finding from consultation text.
 * NO codes in the prompt — prevents hallucination.
 */
export async function extractFinding(
  fullText: string,
  specialty: string,
  conclusions?: string,
): Promise<ExtractedEntity | undefined> {
  // Use conclusions if available (most informative section)
  const textForExtraction =
    conclusions && conclusions.trim().length > 20
      ? `Conclusions:\n${conclusions}\n\nFull text:\n${fullText}`
      : fullText;

  if (!textForExtraction || textForExtraction.trim().length < 50) return undefined;

  const truncated =
    textForExtraction.length > 8000
      ? `${textForExtraction.slice(0, 8000)}\n...[truncated]`
      : textForExtraction;

  try {
    const { object } = await generateObject({
      model: anthropic('claude-sonnet-4-20250514'),
      schema: entitySchema,
      prompt: `You are a clinical coding specialist. Extract the PRIMARY clinical diagnosis from this ${specialty} consultation note.

Rules:
- Return the single most important diagnosis, not a list
- Use standard English medical terminology
- Do NOT assign any codes (SNOMED, ICD-10, etc.)
- If the text is procedural with no diagnosis, return confidence < 0.3
- For Polish/German text, translate the diagnosis to English

Consultation text:
${truncated}`,
    });

    return {
      findingName: object.findingName,
      category: object.category,
      confidence: object.confidence,
      ...(object.severity !== undefined ? { severity: object.severity } : {}),
      ...(object.bodyRegion !== undefined ? { bodyRegion: object.bodyRegion } : {}),
    };
  } catch (err) {
    logger.warn(
      `Pass 1 entity extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

// ── Pass 2: Code assignment (4-tier fallback) ─────────────────────────

interface CodeLookupResult {
  code: string;
  source: CodeSource;
  confidence: number;
}

/** SNOMED 3-tier lookup: static map → embedding → LLM. */
async function resolveSnomedCode(findingName: string): Promise<CodeLookupResult | undefined> {
  // Tier 1: static map
  const staticCode = getSnomedFindingCode(findingName);
  if (staticCode) {
    return { code: staticCode, source: 'static-map', confidence: 1.0 };
  }

  // Tier 2: embedding search
  try {
    const embeddingResult = await searchSnomedByEmbedding(findingName);
    if (embeddingResult) {
      return {
        code: embeddingResult.code,
        source: 'embedding',
        confidence: Math.min(0.95, Math.max(0.85, embeddingResult.similarity)),
      };
    }
  } catch (err) {
    logger.debug(
      `SNOMED embedding search failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Tier 3: LLM
  const llmResult = await assignSnomedViaLlm(findingName);
  if (llmResult) {
    return { code: llmResult.code, source: 'llm', confidence: llmResult.confidence };
  }

  return undefined;
}

/** ICD-10 3-path lookup: crosswalk → static map → embedding. */
async function resolveIcd10Code(
  findingName: string,
  snomedCode: string | undefined,
): Promise<CodeLookupResult | undefined> {
  // Path A: crosswalk from SNOMED
  if (snomedCode) {
    const crosswalks = translateCode(SYSTEM_SNOMED, snomedCode, SYSTEM_ICD10);
    const best = crosswalks[0];
    if (best) {
      return { code: best.targetCode, source: 'crosswalk', confidence: 0.95 };
    }
  }

  // Path B: direct static map
  const directIcd10 = getIcd10Code(findingName);
  if (directIcd10) {
    return { code: directIcd10, source: 'static-map', confidence: 1.0 };
  }

  // Path C: embedding search
  try {
    const embeddingResult = await searchIcd10ByEmbedding(findingName);
    if (embeddingResult) {
      return {
        code: embeddingResult.code,
        source: 'embedding',
        confidence: embeddingResult.similarity,
      };
    }
  } catch (err) {
    logger.debug(
      `ICD-10 embedding search failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return undefined;
}

/**
 * Assign SNOMED and ICD-10 codes to an extracted entity using a 4-tier fallback:
 * 1. Static map lookup
 * 2. Embedding semantic search
 * 3. LLM code assignment (last resort)
 *
 * ICD-10: crosswalk from SNOMED (preferred) or direct lookup.
 */
export async function assignFindingCodes(entity: ExtractedEntity): Promise<AssignedCodes> {
  const snomed = await resolveSnomedCode(entity.findingName);
  const icd10 = await resolveIcd10Code(entity.findingName, snomed?.code);

  const confidence = snomed ? snomed.confidence : entity.confidence;

  return {
    ...(snomed ? { snomedCode: snomed.code, snomedSource: snomed.source } : {}),
    ...(icd10 ? { icd10Code: icd10.code, icd10Source: icd10.source } : {}),
    confidence,
  };
}

// ── LLM SNOMED assignment (Tier 3 helper) ─────────────────────────────

async function assignSnomedViaLlm(
  findingName: string,
  retryWithError?: string,
): Promise<{ code: string; confidence: number } | undefined> {
  const errorContext = retryWithError
    ? `\n\nPrevious attempt returned invalid code: ${retryWithError}. Try a different, verified code.`
    : '';

  try {
    const { object } = await generateObject({
      model: anthropic('claude-sonnet-4-20250514'),
      schema: snomedCodeSchema,
      prompt: `Given this clinical finding: "${findingName}"
Assign the most specific SNOMED CT concept ID (6-18 digit number).
If uncertain, return null rather than guessing.${errorContext}`,
    });

    if (!object.snomedCode) return undefined;

    // Validate format
    if (!/^\d{6,18}$/.test(object.snomedCode)) {
      // Retry once with error feedback
      if (!retryWithError) {
        return assignSnomedViaLlm(findingName, object.snomedCode);
      }
      logger.warn(`LLM SNOMED assignment failed validation after retry for "${findingName}"`);
      return undefined;
    }

    return { code: object.snomedCode, confidence: object.confidence };
  } catch (err) {
    logger.warn(
      `LLM SNOMED assignment failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

// ── Backward-compatible wrapper ───────────────────────────────────────

/** Try deterministic SNOMED map lookup on conclusions text (fast path). */
async function tryDeterministicLookup(conclusions: string): Promise<ExtractedFinding | undefined> {
  const lines = conclusions.split('\n').filter((l) => l.trim().length > 3);
  for (const line of lines) {
    const cleaned = line
      .replace(/^[#*\-/\d.]+\s*/, '')
      .replace(/\([A-Z]\d{2}(\.\d+)?\)/g, '') // strip ICD-10 codes
      .trim();
    const code = getSnomedFindingCode(cleaned);
    if (!code) continue;

    const icd10 = await resolveIcd10Code(cleaned, code);
    return {
      findingName: cleaned,
      snomedCode: code,
      confidence: 0.95,
      snomedSource: 'static-map',
      ...(icd10 ? { icd10Code: icd10.code, icd10Source: icd10.source } : {}),
    };
  }
  return undefined;
}

/**
 * Extract clinical findings from consultation text using two-pass flow.
 *
 * Backward-compatible wrapper: existing callers (ingest-pipeline.ts,
 * tools-clinical.ts) continue to work without changes.
 *
 * Pass 1: deterministic map lookup on conclusions, then LLM entity extraction
 * Pass 2: 4-tier code assignment (static -> embedding -> crosswalk -> LLM)
 */
export async function extractClinicalFindings(
  fullText: string,
  specialty: string,
  conclusions?: string,
): Promise<ExtractedFinding | undefined> {
  // Fast path: deterministic lookup on conclusions
  if (conclusions) {
    const fastResult = await tryDeterministicLookup(conclusions);
    if (fastResult) return fastResult;
  }

  // Pass 1: LLM entity extraction
  const entity = await extractFinding(fullText, specialty, conclusions);
  if (!entity || entity.confidence < 0.3) return undefined;

  // Pass 2: Code assignment
  const codes = await assignFindingCodes(entity);
  if (!codes.snomedCode) return undefined;

  return {
    findingName: entity.findingName,
    snomedCode: codes.snomedCode,
    confidence: codes.confidence,
    ...(codes.snomedSource ? { snomedSource: codes.snomedSource } : {}),
    ...(codes.icd10Code ? { icd10Code: codes.icd10Code } : {}),
    ...(codes.icd10Source ? { icd10Source: codes.icd10Source } : {}),
  };
}
