import { z } from 'zod';

/**
 * Clinical Dashboard Schema — the compact working memory for each patient.
 *
 * This is Layer 1 of the three-layer clinical knowledge architecture.
 * It's injected into EVERY agent call via Mastra's SchemaWorkingMemory.
 *
 * Budget: ~1,500 tokens when populated, ~350 tokens empty.
 * Think of this as the "clinician's screen" — the 5 things you'd glance at
 * before talking to the patient. Everything else lives in Layer 2 (structured
 * clinical record) or Layer 3 (document knowledge base).
 */

const activeConcernSchema = z.object({
  concern: z.string(), // "Progressive upper limb weakness since 2020"
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  since: z.string().optional(), // "2020"
});

const currentHypothesisSchema = z.object({
  diagnosis: z.string(), // "Trigeminocervical convergence"
  confidence: z.number().min(0).max(100), // 55-70
  keyEvidence: z.string(), // "Pain migrated C2→V1/V2 after GON block"
  diagnosticTestOfRecord: z.string().optional(), // "EMG/NCS"
  dtorStatus: z.enum(['not-done', 'pending', 'done']).optional(),
});

const plannedActionSchema = z.object({
  action: z.string(), // "EMG/NCS — most important missing test"
  urgency: z.enum(['immediate', 'soon', 'routine', 'when-feasible']),
  rationale: z.string().optional(),
});

export const clinicalDashboardSchema = z.object({
  demographics: z
    .object({
      age: z.string().optional(), // "34M" — compact
      sex: z.string().optional(),
      keyContext: z.string().optional(), // "16-year diagnostic odyssey, rare disease"
    })
    .optional(),

  activeConcerns: z.array(activeConcernSchema).optional(),

  currentHypotheses: z.array(currentHypothesisSchema).optional(),

  plannedActions: z.array(plannedActionSchema).optional(),

  criticalFindings: z.array(z.string()).optional(),
  // e.g. ["Anti-Ro-60 DISCREPANT: positive microblot vs negative immunoblot (5 days apart)"]
  // e.g. ["WBC declining: 3.5→2.59 over 6 years — nadir 2025"]
  // e.g. ["CGRP pathway EXHAUSTED: 4/4 agents failed"]

  patientGoals: z.array(z.string()).optional(),
  // e.g. ["Wants diagnosis before treatment", "Concerned about weakness progression"]

  recentPatientReport: z.string().optional(),
  // Latest PRO summary: "Pain 7/10 today, can't hold phone >2min, brain fog severe"

  evidenceSummary: z
    .object({
      t1Claims: z.number().int().min(0),
      t2Claims: z.number().int().min(0),
      t3Claims: z.number().int().min(0),
      contradictions: z.number().int().min(0),
      unresolvedDiscrepancies: z.number().int().min(0),
    })
    .optional(),

  dataCompleteness: z
    .object({
      hasT1Records: z.boolean(),
      hasImaging: z.boolean(),
      hasLabs: z.boolean(),
      hasMedications: z.boolean(),
      hasSpecialistNotes: z.boolean(),
    })
    .optional(),

  lastUpdated: z.string().optional(),
});

export type ClinicalDashboard = z.infer<typeof clinicalDashboardSchema>;
export type ActiveConcern = z.infer<typeof activeConcernSchema>;
export type CurrentHypothesis = z.infer<typeof currentHypothesisSchema>;
export type PlannedAction = z.infer<typeof plannedActionSchema>;
