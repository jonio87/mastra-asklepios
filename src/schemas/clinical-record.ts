import { z } from 'zod';

/**
 * Clinical Record Schemas — Layer 2 of the three-layer architecture.
 *
 * These schemas define structured clinical data stored in LibSQL tables,
 * NOT in working memory. The agent accesses them via query/capture tools.
 *
 * Design principles:
 * - Every record has patientId + id for isolation and lookup
 * - Dates are ISO 8601 strings for SQL range queries
 * - Enums use clinical terminology familiar to the agent
 * - Optional fields use Zod .optional() for sparse data
 */

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
  patientId: z.string(),
});

export type LabResult = z.infer<typeof labResultSchema>;

// ─── Treatment Trials ───────────────────────────────────────────────────

export const treatmentTrialSchema = z.object({
  id: z.string(),
  medication: z.string(), // "Erenumab", "Pregabalin"
  drugClass: z.string().optional(), // "CGRP mAb", "anticonvulsant"
  indication: z.string().optional(), // "facial pain", "headache prevention"
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  dosage: z.string().optional(),
  efficacy: z.enum(['none', 'minimal', 'partial', 'significant', 'complete', 'unknown']),
  sideEffects: z.array(z.string()).optional(),
  reasonDiscontinued: z.string().optional(),
  adequateTrial: z.boolean().optional(), // Was dose/duration adequate?
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
  diagnosticImpact: z.string().optional(), // "Affects Sjögren hypothesis confidence"
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
  ]),
  content: z.string(),
  severity: z.number().min(1).max(10).optional(),
  extractedInsights: z.array(z.string()).optional(),
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
  patientId: z.string(),
});

export type AgentLearning = z.infer<typeof agentLearningSchema>;

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
