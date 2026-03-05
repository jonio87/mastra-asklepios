import { z } from 'zod';

/**
 * @deprecated Use clinicalDashboardSchema from './clinical-dashboard.ts' instead.
 *
 * Patient Profile Schema — the original working memory schema (Phase 1-9).
 * Replaced by the compact Clinical Dashboard in Phase 10. The dashboard keeps
 * working memory under ~1,500 tokens; full clinical data lives in Layer 2
 * (ClinicalStore) and Layer 3 (DocumentStore).
 *
 * Kept for backward compatibility and existing test references.
 */

const symptomSchema = z.object({
  name: z.string(),
  severity: z.number().min(1).max(10).optional(),
  onset: z.string().optional(),
  frequency: z.string().optional(),
  bodyLocation: z.string().optional(),
  progression: z.string().optional(),
});

const medicationSchema = z.object({
  name: z.string(),
  dosage: z.string().optional(),
  startDate: z.string().optional(),
  sideEffects: z.array(z.string()).optional(),
});

const hypothesisSchema = z.object({
  diagnosis: z.string(),
  confidence: z.number().min(0).max(100),
  evidence: z.string(),
});

const visitSchema = z.object({
  date: z.string(),
  provider: z.string().optional(),
  specialty: z.string().optional(),
  summary: z.string(),
  actionItems: z.array(z.string()).optional(),
});

export const patientProfileSchema = z.object({
  patientId: z.string().optional(),
  demographics: z
    .object({
      ageRange: z.string().optional(),
      sex: z.string().optional(),
      ethnicity: z.string().optional(),
    })
    .optional(),
  symptoms: z.array(symptomSchema).optional(),
  medications: z.array(medicationSchema).optional(),
  hpoTerms: z.array(z.string()).optional(),
  diagnoses: z
    .object({
      confirmed: z.array(z.string()).optional(),
      suspected: z.array(z.string()).optional(),
      ruledOut: z.array(z.string()).optional(),
    })
    .optional(),
  hypotheses: z.array(hypothesisSchema).optional(),
  pendingTests: z.array(z.string()).optional(),
  visits: z.array(visitSchema).optional(),
  lastUpdated: z.string().optional(),
});

export type PatientProfile = z.infer<typeof patientProfileSchema>;
export type Symptom = z.infer<typeof symptomSchema>;
export type Medication = z.infer<typeof medicationSchema>;
export type Hypothesis = z.infer<typeof hypothesisSchema>;
export type Visit = z.infer<typeof visitSchema>;
