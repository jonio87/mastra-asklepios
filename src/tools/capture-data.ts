import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { EvidenceTier, ValidationStatus } from '../schemas/clinical-record.js';
import type { ClinicalStore } from '../storage/clinical-store.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';

const provenanceFields = {
  evidenceTier: z
    .enum(['T1-official', 'T1-specialist', 'T2-patient-reported', 'T3-ai-inferred'])
    .optional()
    .describe('Evidence tier: T1-official, T1-specialist, T2-patient-reported, T3-ai-inferred'),
  validationStatus: z
    .enum(['unvalidated', 'confirmed', 'contradicted', 'critical-unvalidated'])
    .optional()
    .describe('Validation status against T1 data'),
  sourceCredibility: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe('Source credibility 0-100'),
};

function applyProvenance(
  record: Record<string, unknown>,
  input: {
    evidenceTier?: EvidenceTier | undefined;
    validationStatus?: ValidationStatus | undefined;
    sourceCredibility?: number | undefined;
  },
): void {
  if (input.evidenceTier) record['evidenceTier'] = input.evidenceTier;
  if (input.validationStatus) record['validationStatus'] = input.validationStatus;
  if (input.sourceCredibility !== undefined) record['sourceCredibility'] = input.sourceCredibility;
}

/**
 * Consolidated capture tool — single discriminated-union tool that replaces
 * 6 individual capture tools. Reduces token overhead from ~5K to ~2K per call
 * by sending one tool schema instead of six.
 *
 * The agent specifies `type` to route the capture to the correct handler.
 */

const patientReportData = z.object({
  type: z.literal('patient-report'),
  patientId: z.string().describe('Patient resource ID'),
  reportType: z
    .enum([
      'symptom-update',
      'treatment-response',
      'concern',
      'goal',
      'functional-status',
      'self-observation',
    ])
    .describe('Type of patient report'),
  content: z.string().describe('What the patient reported'),
  severity: z.number().min(1).max(10).optional().describe('Severity 1-10'),
  extractedInsights: z.array(z.string()).optional().describe('Key clinical insights extracted'),
  ...provenanceFields,
});

const agentLearningData = z.object({
  type: z.literal('agent-learning'),
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
  content: z.string().describe('The insight or pattern'),
  confidence: z.number().min(0).max(100).optional().describe('Confidence 0-100'),
  relatedHypotheses: z.array(z.string()).optional().describe('Related diagnostic hypotheses'),
  ...provenanceFields,
});

const contradictionData = z.object({
  type: z.literal('contradiction'),
  patientId: z.string().describe('Patient resource ID'),
  finding1: z.string().describe('First finding'),
  finding1Date: z.string().optional().describe('Date of first finding'),
  finding1Method: z.string().optional().describe('Method/platform of first finding'),
  finding2: z.string().describe('Second (contradicting) finding'),
  finding2Date: z.string().optional().describe('Date of second finding'),
  finding2Method: z.string().optional().describe('Method/platform of second finding'),
  resolutionPlan: z.string().optional().describe('Plan to resolve'),
  diagnosticImpact: z.string().optional().describe('Impact on differential diagnosis'),
  ...provenanceFields,
});

const labResultData = z.object({
  type: z.literal('lab-result'),
  patientId: z.string().describe('Patient resource ID'),
  testName: z.string().describe('Test name (e.g., "WBC", "CRP")'),
  value: z.union([z.number(), z.string()]).describe('Test value'),
  unit: z.string().describe('Unit of measurement'),
  date: z.string().describe('Test date (ISO 8601)'),
  referenceRange: z.string().optional().describe('Reference range'),
  flag: z.enum(['normal', 'low', 'high', 'critical']).optional().describe('Flag status'),
  source: z.string().optional().describe('Lab/institution'),
  notes: z.string().optional().describe('Additional notes'),
  ...provenanceFields,
});

const treatmentTrialData = z.object({
  type: z.literal('treatment-trial'),
  patientId: z.string().describe('Patient resource ID'),
  medication: z.string().describe('Medication name'),
  efficacy: z
    .enum(['none', 'minimal', 'partial', 'significant', 'complete', 'unknown'])
    .describe('Treatment efficacy'),
  drugClass: z.string().optional().describe('Drug class (e.g., "CGRP mAb")'),
  indication: z.string().optional().describe('What it was prescribed for'),
  startDate: z.string().optional().describe('When started'),
  endDate: z.string().optional().describe('When stopped'),
  dosage: z.string().optional().describe('Dosage and frequency'),
  sideEffects: z.array(z.string()).optional().describe('Side effects'),
  reasonDiscontinued: z.string().optional().describe('Why stopped'),
  adequateTrial: z.boolean().optional().describe('Was the trial adequate?'),
  ...provenanceFields,
});

const consultationData = z.object({
  type: z.literal('consultation'),
  patientId: z.string().describe('Patient resource ID'),
  provider: z.string().describe('Provider name'),
  specialty: z.string().describe('Medical specialty'),
  date: z.string().describe('Consultation date (ISO 8601)'),
  conclusionsStatus: z
    .enum(['documented', 'unknown', 'pending'])
    .describe('Whether conclusions are documented'),
  institution: z.string().optional().describe('Institution name'),
  reason: z.string().optional().describe('Reason for consultation'),
  findings: z.string().optional().describe('Clinical findings'),
  conclusions: z.string().optional().describe('Specialist conclusions'),
  recommendations: z.array(z.string()).optional().describe('Specialist recommendations'),
  ...provenanceFields,
});

/**
 * Keep the discriminated union for runtime parsing — it gives precise per-type validation.
 * But Anthropic's API rejects `oneOf` at the top level of tool `input_schema`,
 * so we also build a flat `z.object()` that produces `"type":"object"` in JSON Schema.
 * The flat schema is used as the tool's `inputSchema` (what the LLM sees),
 * while the discriminated union is used inside `execute` to validate at runtime.
 */
const captureDataUnion = z.discriminatedUnion('type', [
  patientReportData,
  agentLearningData,
  contradictionData,
  labResultData,
  treatmentTrialData,
  consultationData,
]);

const captureDataInputSchema = z.object({
  type: z
    .enum([
      'patient-report',
      'agent-learning',
      'contradiction',
      'lab-result',
      'treatment-trial',
      'consultation',
    ])
    .describe('Type of clinical data to capture'),
  patientId: z.string().describe('Patient resource ID'),
  // patient-report fields
  reportType: z
    .enum([
      'symptom-update',
      'treatment-response',
      'concern',
      'goal',
      'functional-status',
      'self-observation',
    ])
    .optional()
    .describe('(patient-report) Type of patient report'),
  content: z.string().optional().describe('Text content of the report/learning'),
  severity: z.number().min(1).max(10).optional().describe('(patient-report) Severity 1-10'),
  extractedInsights: z
    .array(z.string())
    .optional()
    .describe('(patient-report) Key clinical insights extracted'),
  // agent-learning fields
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
    .optional()
    .describe('(agent-learning) Category of learning'),
  confidence: z.number().min(0).max(100).optional().describe('(agent-learning) Confidence 0-100'),
  relatedHypotheses: z
    .array(z.string())
    .optional()
    .describe('(agent-learning) Related diagnostic hypotheses'),
  // contradiction fields
  finding1: z.string().optional().describe('(contradiction) First finding'),
  finding1Date: z.string().optional().describe('(contradiction) Date of first finding'),
  finding1Method: z.string().optional().describe('(contradiction) Method of first finding'),
  finding2: z.string().optional().describe('(contradiction) Second (contradicting) finding'),
  finding2Date: z.string().optional().describe('(contradiction) Date of second finding'),
  finding2Method: z.string().optional().describe('(contradiction) Method of second finding'),
  resolutionPlan: z.string().optional().describe('(contradiction) Plan to resolve'),
  diagnosticImpact: z.string().optional().describe('(contradiction) Impact on diagnosis'),
  // lab-result fields
  testName: z.string().optional().describe('(lab-result) Test name (e.g., "WBC", "CRP")'),
  value: z.union([z.number(), z.string()]).optional().describe('(lab-result) Test value'),
  unit: z.string().optional().describe('(lab-result) Unit of measurement'),
  date: z.string().optional().describe('Date (ISO 8601) — used by lab-result and consultation'),
  referenceRange: z.string().optional().describe('(lab-result) Reference range'),
  flag: z
    .enum(['normal', 'low', 'high', 'critical'])
    .optional()
    .describe('(lab-result) Flag status'),
  source: z.string().optional().describe('(lab-result) Lab/institution'),
  notes: z.string().optional().describe('Additional notes'),
  // treatment-trial fields
  medication: z.string().optional().describe('(treatment-trial) Medication name'),
  efficacy: z
    .enum(['none', 'minimal', 'partial', 'significant', 'complete', 'unknown'])
    .optional()
    .describe('(treatment-trial) Treatment efficacy'),
  drugClass: z.string().optional().describe('(treatment-trial) Drug class (e.g., "CGRP mAb")'),
  indication: z.string().optional().describe('(treatment-trial) What it was prescribed for'),
  startDate: z.string().optional().describe('(treatment-trial) When started'),
  endDate: z.string().optional().describe('(treatment-trial) When stopped'),
  dosage: z.string().optional().describe('(treatment-trial) Dosage and frequency'),
  sideEffects: z.array(z.string()).optional().describe('(treatment-trial) Side effects'),
  reasonDiscontinued: z.string().optional().describe('(treatment-trial) Why stopped'),
  adequateTrial: z.boolean().optional().describe('(treatment-trial) Was the trial adequate?'),
  // consultation fields
  provider: z.string().optional().describe('(consultation) Provider name'),
  specialty: z.string().optional().describe('(consultation) Medical specialty'),
  conclusionsStatus: z
    .enum(['documented', 'unknown', 'pending'])
    .optional()
    .describe('(consultation) Whether conclusions are documented'),
  institution: z.string().optional().describe('(consultation) Institution name'),
  reason: z.string().optional().describe('(consultation) Reason for consultation'),
  findings: z.string().optional().describe('(consultation) Clinical findings'),
  conclusions: z.string().optional().describe('(consultation) Specialist conclusions'),
  recommendations: z
    .array(z.string())
    .optional()
    .describe('(consultation) Specialist recommendations'),
  // provenance fields
  ...provenanceFields,
});

type CaptureResult = { success: boolean; id: string };

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayDate(): string {
  return new Date().toISOString().split('T')[0] ?? new Date().toISOString();
}

// ─── Handler functions (one per capture type) ────────────────────────

async function handlePatientReport(
  store: ClinicalStore,
  input: z.infer<typeof patientReportData>,
): Promise<CaptureResult> {
  const id = generateId('pro');
  logger.debug(`captureData(patient-report): ${input.reportType} for ${input.patientId}`);

  const report: {
    id: string;
    patientId: string;
    date: string;
    type: z.infer<typeof patientReportData>['reportType'];
    content: string;
    severity?: number;
    extractedInsights?: string[];
  } = {
    id,
    patientId: input.patientId,
    date: todayDate(),
    type: input.reportType,
    content: input.content,
  };
  if (input.severity !== undefined) report.severity = input.severity;
  if (input.extractedInsights) report.extractedInsights = input.extractedInsights;
  applyProvenance(report as Record<string, unknown>, input);

  await store.addPatientReport(report);
  return { success: true, id };
}

async function handleAgentLearning(
  store: ClinicalStore,
  input: z.infer<typeof agentLearningData>,
): Promise<CaptureResult> {
  const id = generateId('learn');
  logger.debug(`captureData(agent-learning): ${input.category} for ${input.patientId}`);

  const learning: {
    id: string;
    patientId: string;
    date: string;
    category: z.infer<typeof agentLearningData>['category'];
    content: string;
    confidence?: number;
    relatedHypotheses?: string[];
  } = {
    id,
    patientId: input.patientId,
    date: todayDate(),
    category: input.category,
    content: input.content,
  };
  if (input.confidence !== undefined) learning.confidence = input.confidence;
  if (input.relatedHypotheses) learning.relatedHypotheses = input.relatedHypotheses;
  applyProvenance(learning as Record<string, unknown>, input);

  await store.addAgentLearning(learning);
  return { success: true, id };
}

async function handleContradiction(
  store: ClinicalStore,
  input: z.infer<typeof contradictionData>,
): Promise<CaptureResult> {
  const id = generateId('contra');
  logger.debug(`captureData(contradiction) for ${input.patientId}`);

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
  applyProvenance(contradiction as Record<string, unknown>, input);

  await store.addContradiction(contradiction);
  return { success: true, id };
}

async function handleLabResult(
  store: ClinicalStore,
  input: z.infer<typeof labResultData>,
): Promise<CaptureResult> {
  const id = generateId('lab');
  logger.debug(`captureData(lab-result): ${input.testName} for ${input.patientId}`);

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
  applyProvenance(lab as Record<string, unknown>, input);

  await store.addLabResult(lab);
  return { success: true, id };
}

async function handleTreatmentTrial(
  store: ClinicalStore,
  input: z.infer<typeof treatmentTrialData>,
): Promise<CaptureResult> {
  const id = generateId('trial');
  logger.debug(`captureData(treatment-trial): ${input.medication} for ${input.patientId}`);

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
  } = { id, patientId: input.patientId, medication: input.medication, efficacy: input.efficacy };
  if (input.drugClass) trial.drugClass = input.drugClass;
  if (input.indication) trial.indication = input.indication;
  if (input.startDate) trial.startDate = input.startDate;
  if (input.endDate) trial.endDate = input.endDate;
  if (input.dosage) trial.dosage = input.dosage;
  if (input.sideEffects) trial.sideEffects = input.sideEffects;
  if (input.reasonDiscontinued) trial.reasonDiscontinued = input.reasonDiscontinued;
  if (input.adequateTrial !== undefined) trial.adequateTrial = input.adequateTrial;
  applyProvenance(trial as Record<string, unknown>, input);

  await store.addTreatmentTrial(trial);
  return { success: true, id };
}

async function handleConsultation(
  store: ClinicalStore,
  input: z.infer<typeof consultationData>,
): Promise<CaptureResult> {
  const id = generateId('consult');
  logger.debug(
    `captureData(consultation): ${input.provider} (${input.specialty}) for ${input.patientId}`,
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
  applyProvenance(consultation as Record<string, unknown>, input);

  await store.addConsultation(consultation);
  return { success: true, id };
}

// ─── Tool definition ─────────────────────────────────────────────────

export const captureDataTool = createTool({
  id: 'capture-data',
  description: `Capture structured clinical data from conversations. Use the "type" field to specify what kind of data:
- "patient-report": PROs, symptom updates, treatment responses, concerns, goals, functional status
- "agent-learning": Patterns, insights, temporal correlations, diagnostic clues, evidence gaps
- "contradiction": Conflicting findings with methods, dates, and resolution plans
- "lab-result": Lab values with units, reference ranges, and flags
- "treatment-trial": Medication trials with efficacy, drug class, side effects
- "consultation": Specialist visits with findings, conclusions status, recommendations`,
  inputSchema: captureDataInputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    id: z.string(),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    // Re-parse through the discriminated union for precise per-type validation
    const parsed = captureDataUnion.parse(input);

    switch (parsed.type) {
      case 'patient-report':
        return handlePatientReport(store, parsed);
      case 'agent-learning':
        return handleAgentLearning(store, parsed);
      case 'contradiction':
        return handleContradiction(store, parsed);
      case 'lab-result':
        return handleLabResult(store, parsed);
      case 'treatment-trial':
        return handleTreatmentTrial(store, parsed);
      case 'consultation':
        return handleConsultation(store, parsed);
    }
  },
});
