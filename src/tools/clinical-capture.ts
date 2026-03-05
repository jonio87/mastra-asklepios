import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';

/**
 * Layer 2 Write Tools — captures structured clinical data from conversations.
 *
 * The agent calls these to persist structured information it extracts
 * from patient conversations, document analysis, or its own reasoning.
 * This is how PROs, learnings, and contradictions become queryable data.
 */

// ─── Capture Patient Report (PRO) ──────────────────────────────────────

export const capturePatientReportTool = createTool({
  id: 'capture-patient-report',
  description: `Capture a patient-reported outcome (PRO) or self-observation from the conversation.
Call this whenever the patient shares:
- Symptom updates with severity ratings
- Treatment response feedback ("this medication didn't help")
- Functional status changes ("I can't hold my phone for more than 2 minutes")
- Concerns or goals ("I want a diagnosis before more treatments")
- Self-observations ("my pain is worse when the weather changes")

These are stored in the clinical record and queryable across sessions.`,
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    type: z
      .enum([
        'symptom-update',
        'treatment-response',
        'concern',
        'goal',
        'functional-status',
        'self-observation',
      ])
      .describe('Type of patient report'),
    content: z.string().describe('What the patient reported, in their own words or paraphrased'),
    severity: z.number().min(1).max(10).optional().describe('Severity rating 1-10 if applicable'),
    extractedInsights: z
      .array(z.string())
      .optional()
      .describe('Key clinical insights you extracted from this report'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    id: z.string(),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    const id = `pro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const date = new Date().toISOString().split('T')[0] ?? new Date().toISOString();

    logger.debug(`Capturing patient report: ${input.type} for ${input.patientId}`);

    const report: {
      id: string;
      patientId: string;
      date: string;
      type:
        | 'symptom-update'
        | 'treatment-response'
        | 'concern'
        | 'goal'
        | 'functional-status'
        | 'self-observation';
      content: string;
      severity?: number;
      extractedInsights?: string[];
    } = {
      id,
      patientId: input.patientId,
      date,
      type: input.type,
      content: input.content,
    };
    if (input.severity !== undefined) report.severity = input.severity;
    if (input.extractedInsights) report.extractedInsights = input.extractedInsights;

    await store.addPatientReport(report);
    return { success: true, id };
  },
});

// ─── Capture Agent Learning ─────────────────────────────────────────────

export const captureAgentLearningTool = createTool({
  id: 'capture-agent-learning',
  description: `Persist a clinical insight or pattern you've noticed during conversation.
Call this when you notice:
- A pattern across symptoms or timeline ("pain worsens with barometric pressure")
- A treatment insight ("CGRP pathway fully exhausted — 4/4 agents failed")
- A temporal correlation ("weakness emerged exactly 5 years after pain onset")
- A diagnostic clue ("pain MIGRATED not ADDED — pathognomonic for TCC")
- An evidence gap ("EMG/NCS never performed in 16 years — critical missing test")
- Patient behavior ("tried alternative therapies without medical supervision")

These learnings persist across sessions and inform future diagnostic reasoning.`,
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    category: z
      .enum([
        'pattern-noticed',
        'contradiction-found',
        'treatment-insight',
        'patient-behavior',
        'temporal-correlation',
        'diagnostic-clue',
        'evidence-gap',
      ])
      .describe('Category of learning'),
    content: z.string().describe('The insight or pattern you noticed'),
    confidence: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe('How confident you are in this learning (0-100)'),
    relatedHypotheses: z
      .array(z.string())
      .optional()
      .describe('Diagnostic hypotheses this learning relates to'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    id: z.string(),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    const id = `learn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const date = new Date().toISOString().split('T')[0] ?? new Date().toISOString();

    logger.debug(`Capturing agent learning: ${input.category} for ${input.patientId}`);

    const learning: {
      id: string;
      patientId: string;
      date: string;
      category:
        | 'pattern-noticed'
        | 'contradiction-found'
        | 'treatment-insight'
        | 'patient-behavior'
        | 'temporal-correlation'
        | 'diagnostic-clue'
        | 'evidence-gap';
      content: string;
      confidence?: number;
      relatedHypotheses?: string[];
    } = {
      id,
      patientId: input.patientId,
      date,
      category: input.category,
      content: input.content,
    };
    if (input.confidence !== undefined) learning.confidence = input.confidence;
    if (input.relatedHypotheses) learning.relatedHypotheses = input.relatedHypotheses;

    await store.addAgentLearning(learning);
    return { success: true, id };
  },
});

// ─── Capture Contradiction ──────────────────────────────────────────────

export const captureContradictionTool = createTool({
  id: 'capture-contradiction',
  description: `Record a contradictory or conflicting finding in the clinical record.
Call this when you identify findings that conflict with each other:
- Lab results that disagree (e.g., Anti-Ro-60 positive on one platform, negative on another)
- Clinical findings that don't align with imaging
- Patient-reported timeline vs documented timeline
- Specialist opinions that contradict each other

Include the resolution plan if you can identify one (e.g., "third platform ELISA recommended").`,
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    finding1: z.string().describe('First finding'),
    finding1Date: z.string().optional().describe('Date of first finding'),
    finding1Method: z.string().optional().describe('Method/platform of first finding'),
    finding2: z.string().describe('Second (contradicting) finding'),
    finding2Date: z.string().optional().describe('Date of second finding'),
    finding2Method: z.string().optional().describe('Method/platform of second finding'),
    resolutionPlan: z.string().optional().describe('Plan to resolve the contradiction'),
    diagnosticImpact: z
      .string()
      .optional()
      .describe('How this contradiction affects the differential diagnosis'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    id: z.string(),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    const id = `contra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    logger.debug(`Capturing contradiction for ${input.patientId}`);

    const contradiction: {
      id: string;
      patientId: string;
      finding1: string;
      finding1Date?: string;
      finding1Method?: string;
      finding2: string;
      finding2Date?: string;
      finding2Method?: string;
      resolutionStatus: 'unresolved' | 'pending' | 'resolved';
      resolutionPlan?: string;
      diagnosticImpact?: string;
    } = {
      id,
      patientId: input.patientId,
      finding1: input.finding1,
      finding2: input.finding2,
      resolutionStatus: input.resolutionPlan ? 'pending' : 'unresolved',
    };
    if (input.finding1Date) contradiction.finding1Date = input.finding1Date;
    if (input.finding1Method) contradiction.finding1Method = input.finding1Method;
    if (input.finding2Date) contradiction.finding2Date = input.finding2Date;
    if (input.finding2Method) contradiction.finding2Method = input.finding2Method;
    if (input.resolutionPlan) contradiction.resolutionPlan = input.resolutionPlan;
    if (input.diagnosticImpact) contradiction.diagnosticImpact = input.diagnosticImpact;

    await store.addContradiction(contradiction);
    return { success: true, id };
  },
});

// ─── Capture Lab Result ─────────────────────────────────────────────────

export const captureLabResultTool = createTool({
  id: 'capture-lab-result',
  description: `Store a lab result in the structured clinical record.
Call this when you extract lab values from documents, patient reports, or conversation.
Each result is stored with its date, value, unit, reference range, and flag status.`,
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    testName: z.string().describe('Test name (e.g., "WBC", "CRP", "Anti-Ro-60")'),
    value: z
      .union([z.number(), z.string()])
      .describe('Test value (numeric or qualitative like "positive")'),
    unit: z.string().describe('Unit of measurement'),
    date: z.string().describe('Date of the test (ISO 8601)'),
    referenceRange: z.string().optional().describe('Reference range (e.g., "4.0-10.0")'),
    flag: z.enum(['normal', 'low', 'high', 'critical']).optional().describe('Flag status'),
    source: z.string().optional().describe('Lab/institution that performed the test'),
    notes: z.string().optional().describe('Additional notes'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    id: z.string(),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    const id = `lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    logger.debug(`Capturing lab result: ${input.testName} for ${input.patientId}`);

    const lab: {
      id: string;
      patientId: string;
      testName: string;
      value: number | string;
      unit: string;
      date: string;
      referenceRange?: string;
      flag?: 'normal' | 'low' | 'high' | 'critical';
      source?: string;
      notes?: string;
    } = {
      id,
      patientId: input.patientId,
      testName: input.testName,
      value: input.value,
      unit: input.unit,
      date: input.date,
    };
    if (input.referenceRange) lab.referenceRange = input.referenceRange;
    if (input.flag) lab.flag = input.flag;
    if (input.source) lab.source = input.source;
    if (input.notes) lab.notes = input.notes;

    await store.addLabResult(lab);
    return { success: true, id };
  },
});

// ─── Capture Treatment Trial ────────────────────────────────────────────

export const captureTreatmentTrialTool = createTool({
  id: 'capture-treatment-trial',
  description: `Store a treatment trial (medication attempt) in the clinical record.
Call this when you learn about a medication the patient tried, including its efficacy,
side effects, and whether the trial was adequate. Critical for tracking exhausted pathways.`,
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    medication: z.string().describe('Medication name'),
    drugClass: z
      .string()
      .optional()
      .describe('Drug class (e.g., "CGRP mAb", "SNRI", "anticonvulsant")'),
    indication: z.string().optional().describe('What it was prescribed for'),
    startDate: z.string().optional().describe('When started (ISO 8601)'),
    endDate: z.string().optional().describe('When stopped (ISO 8601)'),
    dosage: z.string().optional().describe('Dosage and frequency'),
    efficacy: z
      .enum(['none', 'minimal', 'partial', 'significant', 'complete', 'unknown'])
      .describe('Treatment efficacy'),
    sideEffects: z.array(z.string()).optional().describe('Side effects experienced'),
    reasonDiscontinued: z.string().optional().describe('Why the medication was stopped'),
    adequateTrial: z
      .boolean()
      .optional()
      .describe('Was the dose/duration adequate for a fair trial?'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    id: z.string(),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    const id = `trial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    logger.debug(`Capturing treatment trial: ${input.medication} for ${input.patientId}`);

    const trial: {
      id: string;
      patientId: string;
      medication: string;
      drugClass?: string;
      indication?: string;
      startDate?: string;
      endDate?: string;
      dosage?: string;
      efficacy: 'none' | 'minimal' | 'partial' | 'significant' | 'complete' | 'unknown';
      sideEffects?: string[];
      reasonDiscontinued?: string;
      adequateTrial?: boolean;
    } = {
      id,
      patientId: input.patientId,
      medication: input.medication,
      efficacy: input.efficacy,
    };
    if (input.drugClass) trial.drugClass = input.drugClass;
    if (input.indication) trial.indication = input.indication;
    if (input.startDate) trial.startDate = input.startDate;
    if (input.endDate) trial.endDate = input.endDate;
    if (input.dosage) trial.dosage = input.dosage;
    if (input.sideEffects) trial.sideEffects = input.sideEffects;
    if (input.reasonDiscontinued) trial.reasonDiscontinued = input.reasonDiscontinued;
    if (input.adequateTrial !== undefined) trial.adequateTrial = input.adequateTrial;

    await store.addTreatmentTrial(trial);
    return { success: true, id };
  },
});

// ─── Capture Consultation ───────────────────────────────────────────────

export const captureConsultationTool = createTool({
  id: 'capture-consultation',
  description: `Store a specialist consultation record. Track provider details, findings,
conclusions, and recommendations. Flag consultations where conclusions are unknown or pending.`,
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    provider: z.string().describe('Provider name'),
    specialty: z.string().describe('Medical specialty'),
    institution: z.string().optional().describe('Institution name'),
    date: z.string().describe('Consultation date (ISO 8601)'),
    reason: z.string().optional().describe('Reason for consultation'),
    findings: z.string().optional().describe('Clinical findings from the consultation'),
    conclusions: z.string().optional().describe('Specialist conclusions'),
    conclusionsStatus: z
      .enum(['documented', 'unknown', 'pending'])
      .describe('Whether conclusions are documented'),
    recommendations: z.array(z.string()).optional().describe('Specialist recommendations'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    id: z.string(),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    const id = `consult-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    logger.debug(
      `Capturing consultation: ${input.provider} (${input.specialty}) for ${input.patientId}`,
    );

    const consultation: {
      id: string;
      patientId: string;
      provider: string;
      specialty: string;
      institution?: string;
      date: string;
      reason?: string;
      findings?: string;
      conclusions?: string;
      conclusionsStatus: 'documented' | 'unknown' | 'pending';
      recommendations?: string[];
    } = {
      id,
      patientId: input.patientId,
      provider: input.provider,
      specialty: input.specialty,
      date: input.date,
      conclusionsStatus: input.conclusionsStatus,
    };
    if (input.institution) consultation.institution = input.institution;
    if (input.reason) consultation.reason = input.reason;
    if (input.findings) consultation.findings = input.findings;
    if (input.conclusions) consultation.conclusions = input.conclusions;
    if (input.recommendations) consultation.recommendations = input.recommendations;

    await store.addConsultation(consultation);
    return { success: true, id };
  },
});
