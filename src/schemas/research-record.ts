import { z } from 'zod';
import { evidenceProvenanceFields } from './clinical-record.js';

/**
 * Research Record Schemas — Layer 2B of the three-layer architecture.
 *
 * These schemas define structured research data stored in LibSQL tables,
 * alongside the clinical data store (Layer 2A). Research data includes:
 * - Research findings (PMIDs, clinical trials, gene pathways, etc.)
 * - Research queries (audit trail and deduplication)
 * - Hypotheses (versioned, with confidence evolution)
 * - Evidence links (hypothesis ↔ finding/clinical record)
 *
 * Design principles:
 * - Every record has patientId + id for isolation and lookup
 * - Dates are ISO 8601 strings for SQL range queries
 * - External IDs extracted and typed for cross-referencing
 * - Evidence provenance fields on all records (reused from clinical-record.ts)
 * - Hypothesis versioning via version + supersededBy chain
 */

// ─── External ID Types ──────────────────────────────────────────────────

export const externalIdTypeValues = [
  'pmid',
  'nct',
  'orpha',
  'omim',
  'gene',
  'pathway',
  'variant',
  'doi',
] as const;

export const externalIdTypeEnum = z.enum(externalIdTypeValues);
export type ExternalIdType = z.infer<typeof externalIdTypeEnum>;

// ─── Evidence Level ─────────────────────────────────────────────────────

export const evidenceLevelValues = [
  'meta-analysis',
  'rct',
  'cohort',
  'case-series',
  'case-report',
  'review',
  'expert-opinion',
  'unknown',
] as const;

export const evidenceLevelEnum = z.enum(evidenceLevelValues);
export type EvidenceLevel = z.infer<typeof evidenceLevelEnum>;

// ─── Evidence Direction (for linking) ───────────────────────────────────

export const directionValues = ['supporting', 'contradicting', 'neutral', 'inconclusive'] as const;

export const directionEnum = z.enum(directionValues);
export type Direction = z.infer<typeof directionEnum>;

// ─── Certainty Level (aligned with diagnostic-synthesis.ts) ─────────────

export const certaintyLevelValues = [
  'ESTABLISHED',
  'STRONG',
  'MODERATE',
  'WEAK',
  'SPECULATIVE',
] as const;

export const certaintyLevelEnum = z.enum(certaintyLevelValues);

// ─── Research Finding ───────────────────────────────────────────────────

export const researchFindingSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  // Source identification
  source: z.string(), // "PubMed", "BioMCP/DGIdb", "ClinicalTrials.gov", "Orphanet"
  sourceTool: z.string().optional(), // "biomcp_article_searcher", "deepResearch", "clinicalTrials"
  externalId: z.string().optional(), // PMID, NCT ID, ORPHA code, OMIM ID, gene symbol
  externalIdType: externalIdTypeEnum.optional(),
  // Content
  title: z.string(),
  summary: z.string(),
  url: z.string().optional(),
  relevance: z.number().min(0).max(1).optional(), // 0.0 - 1.0
  evidenceLevel: evidenceLevelEnum.optional(),
  // Context
  researchQueryId: z.string().optional(), // FK to research_queries
  date: z.string(), // ISO 8601
  rawData: z.string().optional(), // Full JSON response for re-processing
  // Evidence provenance
  ...evidenceProvenanceFields,
});

export type ResearchFinding = z.infer<typeof researchFindingSchema>;

// ─── Research Query ─────────────────────────────────────────────────────

export const researchQuerySchema = z.object({
  id: z.string(),
  patientId: z.string(),
  // Query details
  query: z.string(), // Original search query
  toolUsed: z.string(), // "deepResearch", "biomcp_article_searcher", "clinicalTrials"
  agent: z.string().optional(), // "research-agent", "hypothesis-agent", "asklepios"
  // Results summary
  resultCount: z.number().int().min(0).optional(),
  findingIds: z.array(z.string()).optional(), // research_finding IDs
  // Synthesis
  synthesis: z.string().optional(), // Synthesized summary from deep-research
  gaps: z.array(z.string()).optional(), // Identified knowledge gaps
  suggestedFollowUp: z.array(z.string()).optional(), // Follow-up queries
  // Context
  stage: z.number().int().min(0).max(9).optional(), // Diagnostic flow stage
  date: z.string(), // ISO 8601
  durationMs: z.number().int().optional(), // Query execution time
  // Evidence provenance
  ...evidenceProvenanceFields,
});

export type ResearchQuery = z.infer<typeof researchQuerySchema>;

// ─── Research Hypothesis ────────────────────────────────────────────────

export const researchHypothesisSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  // Hypothesis details
  name: z.string(), // "Craniovertebral Junction Syndrome"
  icdCode: z.string().optional(), // ICD-10 code
  probabilityLow: z.number().min(0).max(100).optional(),
  probabilityHigh: z.number().min(0).max(100).optional(),
  advocateCase: z.string().optional(),
  skepticCase: z.string().optional(),
  arbiterVerdict: z.string().optional(),
  // Classification
  evidenceTier: z.enum(['T1', 'T2', 'T3']).optional(),
  certaintyLevel: certaintyLevelEnum.optional(),
  // Tracking
  stage: z.number().int().min(0).max(9).optional(),
  version: z.number().int().min(1).optional(),
  supersededBy: z.string().optional(), // FK to newer version of same hypothesis
  date: z.string(), // ISO 8601
  // Evidence provenance
  validationStatus: evidenceProvenanceFields.validationStatus,
  sourceCredibility: evidenceProvenanceFields.sourceCredibility,
});

export type ResearchHypothesis = z.infer<typeof researchHypothesisSchema>;

// ─── Hypothesis Evidence Link ───────────────────────────────────────────

export const hypothesisEvidenceLinkSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  hypothesisId: z.string(), // FK to research_hypotheses
  findingId: z.string().optional(), // FK to research_findings (null if clinical record)
  clinicalRecordId: z.string().optional(), // FK to any Layer 2A table
  clinicalRecordType: z
    .enum([
      'lab-result',
      'consultation',
      'contradiction',
      'treatment-trial',
      'patient-report',
      'agent-learning',
    ])
    .optional(),
  // Relationship
  direction: directionEnum,
  claim: z.string(), // "PR3-ANCA positive supports GPA diagnosis"
  confidence: z.number().min(0).max(1).optional(), // 0.0-1.0
  // Context
  tier: z.enum(['T1', 'T2', 'T3']).optional(),
  date: z.string(), // ISO 8601
  notes: z.string().optional(),
});

export type HypothesisEvidenceLink = z.infer<typeof hypothesisEvidenceLinkSchema>;

// ─── Research Summary (computed, not stored) ────────────────────────────

export const researchSummarySchema = z.object({
  patientId: z.string(),
  findingCount: z.number().int(),
  queryCount: z.number().int(),
  hypothesisCount: z.number().int(),
  evidenceLinkCount: z.number().int(),
  topSources: z.array(
    z.object({
      source: z.string(),
      count: z.number().int(),
    }),
  ),
  latestQueryDate: z.string().optional(),
  latestFindingDate: z.string().optional(),
});

export type ResearchSummary = z.infer<typeof researchSummarySchema>;
