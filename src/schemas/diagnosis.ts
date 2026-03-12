import { z } from 'zod';
import { evidenceProvenanceFields } from './clinical-record.js';

/**
 * Diagnosis Schema — Layer 2A explicit diagnosis registry.
 *
 * Replaces the implicit diagnosis tracking scattered across imaging reports,
 * consultations, and agent learnings. Each row represents a confirmed or
 * suspected diagnosis with ICD-10 code, onset date, and linked evidence.
 *
 * The 16-diagnosis table in the diagnostic-therapeutic plan should be
 * queryable from the database, not manually assembled from text blobs.
 */

// ─── Diagnosis Status ───────────────────────────────────────────────────

export const diagnosisStatusValues = [
  'active', // Currently present and clinically relevant
  'stable', // Present but not progressing
  'progressive', // Worsening over time
  'improving', // Getting better
  'resolved', // No longer present
  'suspected', // Under investigation, not confirmed
  'ruled-out', // Evaluated and excluded
] as const;

export const diagnosisStatusEnum = z.enum(diagnosisStatusValues);
export type DiagnosisStatus = z.infer<typeof diagnosisStatusEnum>;

// ─── Body Region ────────────────────────────────────────────────────────

export const bodyRegionValues = [
  'craniovertebral-junction',
  'cervical-spine',
  'thoracic-spine',
  'lumbar-spine',
  'head-brain',
  'face-trigeminal',
  'maxillary-sinus',
  'gastrointestinal',
  'hepatobiliary',
  'cardiovascular',
  'musculoskeletal',
  'hematologic',
  'immunologic',
  'neurologic',
  'endocrine',
  'respiratory',
  'dermatologic',
  'ophthalmologic',
  'urologic',
  'systemic',
  'other',
] as const;

export const bodyRegionEnum = z.enum(bodyRegionValues);
export type BodyRegion = z.infer<typeof bodyRegionEnum>;

// ─── Diagnosis Schema ───────────────────────────────────────────────────

export const diagnosisSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  // Classification
  icd10Code: z.string().optional(), // 'M51.1', 'Q76.1', 'G90'
  conditionName: z.string(), // 'Cervical disc herniation at C7/T1'
  conditionNamePl: z.string().optional(), // 'Przepuklina dysku szyjnego C7/T1'
  // Temporal tracking
  onsetDate: z.string().optional(), // ISO 8601 — when condition started
  firstDocumentedDate: z.string().optional(), // ISO 8601 — first appears in records
  // Status
  currentStatus: diagnosisStatusEnum,
  bodyRegion: bodyRegionEnum.optional(),
  confidence: z.number().min(0).max(1).optional(), // 0.0-1.0
  // Evidence
  supportingEvidenceIds: z.array(z.string()).optional(), // IDs of supporting records
  notes: z.string().optional(),
  // Evidence provenance
  ...evidenceProvenanceFields,
  // Timestamps
  createdAt: z.string().optional(), // ISO 8601
  updatedAt: z.string().optional(), // ISO 8601
});

export type Diagnosis = z.infer<typeof diagnosisSchema>;

// ─── Diagnosis Query ────────────────────────────────────────────────────

export const diagnosisQuerySchema = z.object({
  patientId: z.string(),
  icd10Code: z.string().optional(),
  currentStatus: diagnosisStatusEnum.optional(),
  bodyRegion: bodyRegionEnum.optional(),
  limit: z.number().int().positive().optional(),
});

export type DiagnosisQuery = z.infer<typeof diagnosisQuerySchema>;
