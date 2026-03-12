import { z } from 'zod';
import type { DocumentType } from '../knowledge/document-store.js';
import { evidenceTierEnum, validationStatusEnum } from '../schemas/clinical-record.js';

/**
 * Validation schemas for medical-records repo input format.
 *
 * These validate the SOURCE markdown files (YAML frontmatter + structured
 * values blocks), not the internal Asklepios schemas. Fail-early validation
 * catches format issues before any database writes.
 */

// ─── Document type enums ─────────────────────────────────────────────────

/** Source document types as stored in medical-records repo */
export const sourceDocTypeEnum = z.enum([
  'lab_result',
  'consultation',
  'imaging_report',
  'procedure', // FHIR Procedure — gastroscopy, colonoscopy, SIBO (was: abdominal)
  'narrative',
  'external',
  'other', // Non-medical files (DICOM viewer docs, etc.)
]);

export type SourceDocType = z.infer<typeof sourceDocTypeEnum>;

/**
 * FHIR R4-aligned Asklepios document types for Layer 3 ingestion.
 *
 * Maps to FHIR resources:
 *   diagnostic-report → DiagnosticReport (LOINC 26436-6 / 18748-4)
 *   procedure-note    → Procedure (LOINC 28570-0)
 *   clinical-note     → DocumentReference (LOINC 11488-4)
 *   patient-document  → DocumentReference (LOINC 51855-5)
 *   research-paper    → external literature
 *   other             → non-medical
 */
export const asklepiosTypeEnum = z.enum([
  'diagnostic-report',
  'procedure-note',
  'clinical-note',
  'patient-document',
  'research-paper',
  'other',
]);

export type AsklepiosType = z.infer<typeof asklepiosTypeEnum>;

/**
 * Mapping from source document_type to FHIR R4-aligned Asklepios DocumentType.
 *
 * | Source          | Asklepios         | FHIR Resource     | LOINC     |
 * |-----------------|-------------------|--------------------|-----------|
 * | lab_result      | diagnostic-report | DiagnosticReport   | 26436-6   |
 * | imaging_report  | diagnostic-report | DiagnosticReport   | 18748-4   |
 * | procedure       | procedure-note    | Procedure          | 28570-0   |
 * | consultation    | clinical-note     | DocumentReference  | 11488-4   |
 * | external        | clinical-note     | DocumentReference  | 11488-4   |
 * | narrative       | patient-document  | DocumentReference  | 51855-5   |
 * | other           | other             | —                  | —         |
 */
export const documentTypeMapping: Record<SourceDocType, DocumentType> = {
  lab_result: 'diagnostic-report',
  imaging_report: 'diagnostic-report',
  procedure: 'procedure-note',
  consultation: 'clinical-note',
  external: 'clinical-note',
  narrative: 'patient-document',
  other: 'other',
};

// ─── YAML frontmatter schema ─────────────────────────────────────────────

export const recordFrontmatterSchema = z
  .object({
    // Required fields
    document_id: z.string().min(1),
    document_type: sourceDocTypeEnum,
    patient_id: z.string().min(1),
    asklepios_type: asklepiosTypeEnum,

    // Evidence provenance (required for import)
    evidence_tier: evidenceTierEnum,
    validation_status: validationStatusEnum,
    source_credibility: z.number().int().min(0).max(100),

    // Optional metadata — YAML `null` is parsed as JS null, preprocess to undefined
    date: z.preprocess((v) => v ?? undefined, z.string().optional()),
    extraction_confidence: z.number().min(0).max(1).optional(),
    source_file: z.string().optional(),
    source_lab: z.string().optional(),
    facility: z.string().optional(),
    institution: z.string().optional(),
    category: z.string().optional(),
    language: z.string().optional(),
    extraction_model: z.string().optional(),

    // Arrays (optional)
    tags: z.array(z.string()).optional(),
    loinc_codes: z.array(z.string()).optional(),
    icd10_codes: z.array(z.string()).optional(),
    related_documents: z.array(z.string()).optional(),
  })
  .passthrough(); // Allow extra fields (modality, body_region, physician, etc.)

export type RecordFrontmatter = z.infer<typeof recordFrontmatterSchema>;

// ─── Structured lab value schema ─────────────────────────────────────────

export const labFlagEnum = z.enum(['normal', 'low', 'high', 'critical']);

export const structuredLabValueSchema = z.object({
  test_name: z.string().min(1),
  test_name_pl: z.string().optional(),
  loinc: z.string().optional(),
  value: z.union([z.number(), z.string()]),
  unit: z.string(),
  reference_range: z.string().optional(),
  flag: labFlagEnum,
  date: z.string().min(1), // ISO 8601 date
});

export type StructuredLabValue = z.infer<typeof structuredLabValueSchema>;

/** Schema for the lab_values YAML block inside ## Structured Values */
export const structuredValuesBlockSchema = z.object({
  lab_values: z.array(structuredLabValueSchema),
});
