import { z } from 'zod';

/**
 * Clinical Record Schemas — Layer 1 of the five-layer architecture.
 *
 * These schemas define structured clinical data stored in LibSQL tables,
 * NOT in working memory. The agent accesses them via query/capture tools.
 *
 * Design principles:
 * - Every record has patientId + id for isolation and lookup
 * - Dates are ISO 8601 strings for SQL range queries
 * - Enums use clinical terminology familiar to the agent
 * - Optional fields use Zod .optional() for sparse data
 * - Evidence provenance fields (evidenceTier, validationStatus, sourceCredibility) on all records
 */

// ─── FHIR R4-aligned Document Category ──────────────────────────────────
//
// Maps internal table types to FHIR R4 resource model:
//   DiagnosticReport → lab results, imaging, endoscopy, functional tests
//   Encounter        → consultations, hospital stays
//   MedicationStatement → treatment trials
//   ClinicalImpression → contradictions, agent learnings
//   Observation      → patient-reported outcomes
//   DocumentReference → narratives, external documents

export const documentCategoryEnum = z.enum([
  'diagnostic-report', // Labs, imaging, endoscopy, functional tests
  'encounter', // Consultations, hospital stays
  'medication-statement', // Treatment trials
  'clinical-impression', // Contradictions, agent learnings
  'patient-observation', // Patient-reported outcomes
  'document-reference', // Narratives, external documents
]);

export type DocumentCategory = z.infer<typeof documentCategoryEnum>;

// ─── FHIR R4 Status ────────────────────────────────────────────────────

export const fhirStatusEnum = z.enum([
  'final', // Complete and verified
  'preliminary', // Not yet verified
  'amended', // Subsequent to being final
  'entered-in-error', // Erroneous entry
]);

export type FhirStatus = z.infer<typeof fhirStatusEnum>;

// ─── FHIR Metadata (shared across all L1 record types) ─────────────────

/** Fields added to every L1 clinical record for FHIR R4 alignment */
export const fhirMetadataFields = {
  sourceDocumentId: z.string().optional(), // FK to source_documents.id
  fhirResourceType: z.string().optional(), // e.g. 'Encounter', 'DiagnosticReport', 'Procedure'
  fhirStatus: fhirStatusEnum.optional(),
  documentCategory: documentCategoryEnum.optional(),
};

// ─── Evidence Provenance (shared across all record types) ───────────────

export const evidenceTierEnum = z.enum([
  'T1-official', // Lab reports, imaging, official medical records
  'T1-specialist', // Specialist-confirmed findings
  'T2-patient-reported', // Patient self-report, informal notes
  'T3-ai-inferred', // AI hypotheses, literature synthesis
  // Research quality tiers (used by research-agent evidence hierarchy)
  'meta-analysis',
  'RCT',
  'cohort',
  'case-series',
  'case-report',
  'expert-opinion',
]);

export const validationStatusEnum = z.enum([
  'unvalidated', // Not yet checked against T1 data
  'confirmed', // Matches T1 records
  'contradicted', // Conflicts with T1 records
  'critical-unvalidated', // Clinically important, no T1 verification
]);

/** Fields added to every clinical record type for evidence tracking */
export const evidenceProvenanceFields = {
  evidenceTier: evidenceTierEnum.optional(),
  validationStatus: validationStatusEnum.optional(),
  sourceCredibility: z.number().int().min(0).max(100).optional(), // 0-100
};

export type EvidenceTier = z.infer<typeof evidenceTierEnum>;
export type ValidationStatus = z.infer<typeof validationStatusEnum>;

// ─── Lab Results ────────────────────────────────────────────────────────

export const labResultSchema = z.object({
  id: z.string(),
  testName: z.string(), // "WBC", "CRP", "Anti-Ro-60"
  value: z.union([z.number(), z.string()]), // numeric or qualitative ("positive")
  unit: z.string(),
  referenceRange: z.string().optional(), // "4.0-10.0"
  flag: z.enum(['normal', 'low', 'high', 'critical']).optional(),
  date: z.string(), // ISO 8601
  source: z.string().optional(), // "Diagnostyka Sp. z o.o."
  notes: z.string().optional(),
  loincCode: z.string().optional(), // LOINC code (e.g., "6690-2" for WBC)
  valueSnomedCode: z.string().optional(), // SNOMED CT code for qualitative results (e.g., "260385009" for negative)
  extractionConfidence: z.number().min(0).max(1).optional(), // 0-1 extraction confidence score
  ...evidenceProvenanceFields,
  ...fhirMetadataFields,
  patientId: z.string(),
});

export type LabResult = z.infer<typeof labResultSchema>;

// ─── Treatment Trials ───────────────────────────────────────────────────

export const treatmentTrialSchema = z.object({
  id: z.string(),
  medication: z.string(), // "Erenumab", "Pregabalin"
  rxnormCode: z.string().optional(), // RxNorm CUI for linking to medications table
  drugClass: z.string().optional(), // "CGRP mAb", "anticonvulsant"
  indication: z.string().optional(), // "facial pain", "headache prevention"
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  dosage: z.string().optional(),
  efficacy: z.enum(['none', 'minimal', 'partial', 'significant', 'complete', 'unknown']),
  sideEffects: z.array(z.string()).optional(),
  reasonDiscontinued: z.string().optional(),
  adequateTrial: z.boolean().optional(), // Was dose/duration adequate?
  source: z.string().optional(), // Document source for provenance tracking
  ...evidenceProvenanceFields,
  ...fhirMetadataFields,
  patientId: z.string(),
});

export type TreatmentTrial = z.infer<typeof treatmentTrialSchema>;

// ─── Consultations ──────────────────────────────────────────────────────

export const consultationSchema = z.object({
  id: z.string(),
  provider: z.string(), // "Prof. Joanna Zakrzewska"
  specialty: z.string(), // "Orofacial Pain"
  institution: z.string().optional(), // "UCL Eastman Dental Institute"
  date: z.string(),
  reason: z.string().optional(),
  findings: z.string().optional(),
  conclusions: z.string().optional(),
  conclusionsStatus: z.enum(['documented', 'unknown', 'pending']),
  recommendations: z.array(z.string()).optional(),
  source: z.string().optional(), // Document source for provenance tracking
  snomedSpecialtyCode: z.string().optional(), // SNOMED CT specialty code (e.g., "394591006" for neurology)
  snomedFindingCode: z.string().optional(), // SNOMED CT clinical finding code (e.g., "398057008" for tension-type headache)
  icd10Code: z.string().optional(), // ICD-10 code (from SNOMED crosswalk or direct lookup)
  extractionConfidence: z.number().min(0).max(1).optional(), // 0-1 extraction confidence score
  ...evidenceProvenanceFields,
  ...fhirMetadataFields,
  patientId: z.string(),
});

export type Consultation = z.infer<typeof consultationSchema>;

// ─── Contradictions ─────────────────────────────────────────────────────

export const contradictionSchema = z.object({
  id: z.string(),
  finding1: z.string(), // "Anti-Ro-60 positive 329.41 U/ml (TestLine microblot)"
  finding1Date: z.string().optional(),
  finding1Method: z.string().optional(), // "TestLine 44-antigen microblot"
  finding2: z.string(), // "Anti-Ro-60 negative (Euroimmun immunoblot)"
  finding2Date: z.string().optional(),
  finding2Method: z.string().optional(), // "Euroimmun ENA immunoblot"
  resolutionStatus: z.enum(['unresolved', 'pending', 'resolved']),
  resolutionPlan: z.string().optional(), // "Third platform ELISA recommended"
  diagnosticImpact: z.string().optional(), // \"Affects Sjögren hypothesis confidence\"
  source: z.string().optional(), // Document source for provenance tracking
  ...evidenceProvenanceFields,
  ...fhirMetadataFields,
  patientId: z.string(),
});

export type Contradiction = z.infer<typeof contradictionSchema>;

// ─── Patient-Reported Outcomes (PROs) ───────────────────────────────────

export const patientReportSchema = z.object({
  id: z.string(),
  date: z.string(),
  type: z.enum([
    'symptom-update', // "Pain 7/10 today, worse than last week"
    'treatment-response', // "Erenumab didn't help after 3 months"
    'concern', // "Worried about the new weakness"
    'goal', // "Want a diagnosis before more treatments"
    'functional-status', // "Can't hold phone >2min, hand numbness"
    'self-observation', // "Pain worse with weather changes"
    'medical-history', // Chronological patient medical history / historia chorób
  ]),
  content: z.string(),
  severity: z.number().min(1).max(10).optional(),
  extractedInsights: z.array(z.string()).optional(),
  source: z.string().optional(), // Document source for provenance tracking
  extractionConfidence: z.number().min(0).max(1).optional(), // 0-1 extraction confidence score
  ...evidenceProvenanceFields,
  ...fhirMetadataFields,
  patientId: z.string(),
});

export type PatientReport = z.infer<typeof patientReportSchema>;

// ─── Agent Learnings ────────────────────────────────────────────────────

export const agentLearningSchema = z.object({
  id: z.string(),
  date: z.string(),
  category: z.enum([
    'pattern-noticed', // "pain worsens with barometric pressure"
    'contradiction-found', // "Anti-Ro-60 results conflict"
    'treatment-insight', // "CGRP pathway fully exhausted (4/4 failed)"
    'patient-behavior', // "tried alternative therapies without disclosure"
    'temporal-correlation', // "weakness emerged 5 years after pain onset"
    'diagnostic-clue', // "pain MIGRATED not ADDED — pathognomonic for TCC"
    'evidence-gap', // "EMG/NCS never performed in 16 years"
  ]),
  content: z.string(),
  confidence: z.number().min(0).max(100).optional(),
  relatedHypotheses: z.array(z.string()).optional(),
  source: z.string().optional(), // Document source for provenance tracking
  ...evidenceProvenanceFields,
  ...fhirMetadataFields,
  patientId: z.string(),
});

export type AgentLearning = z.infer<typeof agentLearningSchema>;

// ─── Imaging Reports ────────────────────────────────────────────────────

export const imagingReportSchema = z.object({
  id: z.string(),
  modality: z.string(), // "MRI", "CT", "X-ray", "scintigraphy", "ultrasound"
  bodyRegion: z.string(), // "cervical_spine", "head", "thoracic_spine"
  date: z.string(),
  facility: z.string().optional(), // "NZOZ Skanmex Diagnostyka"
  physician: z.string().optional(), // "Lek. Paweł Szewczyk"
  technique: z.string().optional(), // Imaging technique / protocol
  findings: z.string().optional(), // Full findings text (no truncation)
  impression: z.string().optional(), // Radiologist impression / summary
  comparison: z.string().optional(), // Comparison with prior studies
  source: z.string().optional(), // Source PDF filename
  diagnosticServiceSection: z.string().optional(), // FHIR DiagnosticReport service section (e.g., "RAD", "NUC")
  loincStudyCode: z.string().optional(), // LOINC code for the imaging study type (e.g., "36801-9" for MRI Brain)
  bodySiteSnomedCode: z.string().optional(), // SNOMED CT anatomical body site code (e.g., "69536005" for Head)
  extractionConfidence: z.number().min(0).max(1).optional(), // 0-1 extraction confidence score
  ...evidenceProvenanceFields,
  ...fhirMetadataFields,
  patientId: z.string(),
});

export type ImagingReport = z.infer<typeof imagingReportSchema>;

// ─── Procedure Reports (FHIR Procedure) ────────────────────────────────

export const procedureReportSchema = z.object({
  id: z.string(),
  procedureType: z.string(), // "gastroscopy", "colonoscopy", "pH-metry", "SIBO", "ultrasound", "consultation", "other"
  date: z.string(),
  facility: z.string().optional(),
  physician: z.string().optional(),
  findings: z.string().optional(), // Full findings text
  conclusions: z.string().optional(), // Assessment / interpretation
  source: z.string().optional(), // Source PDF filename
  loincProcedureCode: z.string().optional(), // LOINC code for procedure type (e.g., "28010-7" for gastroscopy)
  extractionConfidence: z.number().min(0).max(1).optional(), // 0-1 extraction confidence score
  ...evidenceProvenanceFields,
  ...fhirMetadataFields,
  patientId: z.string(),
});

export type ProcedureReport = z.infer<typeof procedureReportSchema>;

/** @deprecated Use procedureReportSchema — kept for backward compatibility */
export const abdominalReportSchema = procedureReportSchema;
/** @deprecated Use ProcedureReport — kept for backward compatibility */
export type AbdominalReport = ProcedureReport;

// ─── Lab Trend (computed, not stored) ───────────────────────────────────

export const labTrendSchema = z.object({
  testName: z.string(),
  values: z.array(
    z.object({
      date: z.string(),
      value: z.number(),
      flag: z.enum(['normal', 'low', 'high', 'critical']).optional(),
    }),
  ),
  direction: z.enum(['rising', 'falling', 'stable', 'fluctuating']),
  rateOfChange: z.number().optional(), // units per year
  latestValue: z.number(),
  latestDate: z.string(),
  isAbnormal: z.boolean(),
  clinicalNote: z.string().optional(), // "Approaching critical threshold"
});

export type LabTrend = z.infer<typeof labTrendSchema>;

// ─── Phase C Readiness Schemas (empty tables, ready for extraction) ─────

// FHIR Condition — confirmed diagnoses with ICD-10, onset dates, status
export const conditionSchema = z.object({
  id: z.string(),
  code: z.string(), // ICD-10 code (e.g., "G50.0")
  codeSystem: z.string().default('ICD-10'), // Code system identifier
  displayName: z.string(), // Human-readable name (e.g., "Trigeminal neuralgia")
  clinicalStatus: z.enum(['active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved']),
  verificationStatus: z.enum([
    'unconfirmed',
    'provisional',
    'differential',
    'confirmed',
    'refuted',
    'entered-in-error',
  ]),
  onsetDate: z.string().optional(), // ISO 8601
  abatementDate: z.string().optional(), // When condition resolved
  category: z.string().optional(), // "encounter-diagnosis", "problem-list-item"
  severity: z.enum(['mild', 'moderate', 'severe']).optional(),
  notes: z.string().optional(),
  ...evidenceProvenanceFields,
  ...fhirMetadataFields,
  patientId: z.string(),
});

export type Condition = z.infer<typeof conditionSchema>;

// FHIR AllergyIntolerance — drug allergies and intolerances
export const allergyIntoleranceSchema = z.object({
  id: z.string(),
  substance: z.string(), // "Penicillin", "Aspirin", "Lactose"
  reaction: z.string().optional(), // "rash", "anaphylaxis", "GI upset"
  severity: z.enum(['mild', 'moderate', 'severe']).optional(),
  clinicalStatus: z.enum(['active', 'inactive', 'resolved']),
  type: z.enum(['allergy', 'intolerance']),
  ...evidenceProvenanceFields,
  ...fhirMetadataFields,
  patientId: z.string(),
});

export type AllergyIntolerance = z.infer<typeof allergyIntoleranceSchema>;

// FHIR FamilyMemberHistory — genetic predisposition reasoning
export const familyHistorySchema = z.object({
  id: z.string(),
  relationship: z.string(), // "mother", "father", "sibling", "maternal_grandmother"
  condition: z.string(), // "breast cancer", "diabetes", "autoimmune disease"
  onsetAge: z.string().optional(), // Age at onset if known
  deceased: z.boolean().optional(),
  ...evidenceProvenanceFields,
  ...fhirMetadataFields,
  patientId: z.string(),
});

export type FamilyHistory = z.infer<typeof familyHistorySchema>;
