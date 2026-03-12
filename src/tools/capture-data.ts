import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { normalizeSpecialty } from '../importers/specialty-normalizer.js';
import type { EvidenceTier, ValidationStatus } from '../schemas/clinical-record.js';
import { evidenceProvenanceFields } from '../schemas/clinical-record.js';
import {
  certaintyLevelEnum,
  evidenceLevelEnum,
  externalIdTypeEnum,
} from '../schemas/research-record.js';
import type { ClinicalStore } from '../storage/clinical-store.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';

const provenanceFields = evidenceProvenanceFields;

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

// ─── Research data schemas (Layer 2B) ────────────────────────────────

const researchFindingData = z.object({
  type: z.literal('research-finding'),
  patientId: z.string().describe('Patient resource ID'),
  source: z
    .string()
    .describe('Source database (e.g., "PubMed", "BioMCP/DGIdb", "ClinicalTrials.gov")'),
  sourceTool: z.string().optional().describe('Tool that produced this finding'),
  externalId: z
    .string()
    .optional()
    .describe('External identifier (PMID, NCT ID, ORPHA code, etc.)'),
  externalIdType: externalIdTypeEnum.optional().describe('Type of external identifier'),
  title: z.string().describe('Finding title'),
  summary: z.string().describe('Finding summary'),
  url: z.string().optional().describe('Source URL'),
  relevance: z.number().min(0).max(1).optional().describe('Relevance score 0.0-1.0'),
  evidenceLevel: evidenceLevelEnum.optional().describe('Evidence level'),
  researchQueryId: z.string().optional().describe('FK to research query that produced this'),
  rawData: z.string().optional().describe('Full JSON response for re-processing'),
  ...provenanceFields,
});

const researchQueryData = z.object({
  type: z.literal('research-query'),
  patientId: z.string().describe('Patient resource ID'),
  query: z.string().describe('Original search query'),
  toolUsed: z.string().describe('Tool used (e.g., "deepResearch", "biomcp_article_searcher")'),
  agent: z.string().optional().describe('Agent that initiated the query'),
  resultCount: z.number().int().min(0).optional().describe('Number of results found'),
  findingIds: z.array(z.string()).optional().describe('IDs of research findings from this query'),
  synthesis: z.string().optional().describe('Synthesized summary from the research'),
  gaps: z.array(z.string()).optional().describe('Identified knowledge gaps'),
  suggestedFollowUp: z.array(z.string()).optional().describe('Suggested follow-up queries'),
  stage: z.number().int().min(0).max(9).optional().describe('Diagnostic flow stage (0-9)'),
  durationMs: z.number().int().optional().describe('Query execution time in ms'),
  ...provenanceFields,
});

const hypothesisData = z.object({
  type: z.literal('hypothesis'),
  patientId: z.string().describe('Patient resource ID'),
  name: z.string().describe('Hypothesis name (e.g., "Craniovertebral Junction Syndrome")'),
  icdCode: z.string().optional().describe('ICD-10 code'),
  probabilityLow: z.number().min(0).max(100).optional().describe('Lower bound probability 0-100'),
  probabilityHigh: z.number().min(0).max(100).optional().describe('Upper bound probability 0-100'),
  advocateCase: z.string().optional().describe('Case in favor of this hypothesis'),
  skepticCase: z.string().optional().describe('Case against this hypothesis'),
  arbiterVerdict: z.string().optional().describe('Arbiter synthesis/verdict'),
  hypothesisEvidenceTier: z
    .enum(['T1', 'T2', 'T3'])
    .optional()
    .describe('Evidence tier for hypothesis'),
  certaintyLevel: certaintyLevelEnum.optional().describe('Certainty level'),
  stage: z.number().int().min(0).max(9).optional().describe('Diagnostic flow stage (0-9)'),
  version: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Hypothesis version (increments on re-ranking)'),
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
  researchFindingData,
  researchQueryData,
  hypothesisData,
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
      'research-finding',
      'research-query',
      'hypothesis',
    ])
    .describe('Type of clinical/research data to capture'),
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
  // research-finding fields
  sourceTool: z.string().optional().describe('(research-finding) Tool that produced this finding'),
  externalId: z
    .string()
    .optional()
    .describe('(research-finding) External identifier (PMID, NCT ID, etc.)'),
  externalIdType: externalIdTypeEnum
    .optional()
    .describe('(research-finding) Type of external identifier'),
  title: z.string().optional().describe('(research-finding) Finding title'),
  summary: z.string().optional().describe('(research-finding) Finding summary'),
  url: z.string().optional().describe('(research-finding) Source URL'),
  relevance: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('(research-finding) Relevance score 0.0-1.0'),
  evidenceLevel: evidenceLevelEnum.optional().describe('(research-finding) Evidence level'),
  researchQueryId: z.string().optional().describe('(research-finding) FK to research query'),
  rawData: z
    .string()
    .optional()
    .describe('(research-finding) Full JSON response for re-processing'),
  // research-query fields
  query: z.string().optional().describe('(research-query) Original search query'),
  toolUsed: z.string().optional().describe('(research-query) Tool used'),
  agent: z.string().optional().describe('(research-query) Agent that initiated the query'),
  resultCount: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('(research-query) Number of results found'),
  findingIds: z.array(z.string()).optional().describe('(research-query) IDs of research findings'),
  synthesis: z.string().optional().describe('(research-query) Synthesized summary'),
  gaps: z.array(z.string()).optional().describe('(research-query) Identified knowledge gaps'),
  suggestedFollowUp: z
    .array(z.string())
    .optional()
    .describe('(research-query) Suggested follow-up queries'),
  durationMs: z.number().int().optional().describe('(research-query) Query execution time in ms'),
  // hypothesis fields
  name: z.string().optional().describe('(hypothesis) Hypothesis name'),
  icdCode: z.string().optional().describe('(hypothesis) ICD-10 code'),
  probabilityLow: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('(hypothesis) Lower bound probability 0-100'),
  probabilityHigh: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('(hypothesis) Upper bound probability 0-100'),
  advocateCase: z.string().optional().describe('(hypothesis) Case in favor'),
  skepticCase: z.string().optional().describe('(hypothesis) Case against'),
  arbiterVerdict: z.string().optional().describe('(hypothesis) Arbiter synthesis/verdict'),
  hypothesisEvidenceTier: z
    .enum(['T1', 'T2', 'T3'])
    .optional()
    .describe('(hypothesis) Evidence tier'),
  certaintyLevel: certaintyLevelEnum.optional().describe('(hypothesis) Certainty level'),
  stage: z.number().int().min(0).max(9).optional().describe('Diagnostic flow stage (0-9)'),
  version: z.number().int().min(1).optional().describe('(hypothesis) Version number'),
  // provenance fields
  ...provenanceFields,
});

type CaptureResult = { success: boolean; id: string; duplicate?: boolean };

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
  // Dedup guard: skip if identical report already exists
  const existing = await store.findPatientReport(input.patientId, input.reportType, input.content);
  if (existing) {
    logger.debug(`captureData(patient-report): SKIP duplicate for ${input.patientId}`);
    return { success: true, id: existing };
  }

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
    source?: string;
  } = {
    id,
    patientId: input.patientId,
    date: todayDate(),
    type: input.reportType,
    content: input.content,
  };
  if (input.severity !== undefined) report.severity = input.severity;
  if (input.extractedInsights) report.extractedInsights = input.extractedInsights;
  report.source = 'agent-captured';
  applyProvenance(report as Record<string, unknown>, input);

  await store.addPatientReport(report);
  return { success: true, id };
}

async function handleAgentLearning(
  store: ClinicalStore,
  input: z.infer<typeof agentLearningData>,
): Promise<CaptureResult> {
  // Dedup guard: skip if identical learning already exists
  const existing = await store.findAgentLearning(input.patientId, input.category, input.content);
  if (existing) {
    logger.debug(`captureData(agent-learning): SKIP duplicate for ${input.patientId}`);
    return { success: true, id: existing };
  }

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
    source?: string;
  } = {
    id,
    patientId: input.patientId,
    date: todayDate(),
    category: input.category,
    content: input.content,
  };
  if (input.confidence !== undefined) learning.confidence = input.confidence;
  if (input.relatedHypotheses) learning.relatedHypotheses = input.relatedHypotheses;
  learning.source = 'agent-captured';
  applyProvenance(learning as Record<string, unknown>, input);

  await store.addAgentLearning(learning);
  return { success: true, id };
}

async function handleContradiction(
  store: ClinicalStore,
  input: z.infer<typeof contradictionData>,
): Promise<CaptureResult> {
  // Dedup guard: skip if identical contradiction already exists
  const existing = await store.findContradiction(input.patientId, input.finding1, input.finding2);
  if (existing) {
    logger.debug(`captureData(contradiction): SKIP duplicate for ${input.patientId}`);
    return { success: true, id: existing };
  }

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
    source?: string;
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
  contradiction.source = 'agent-captured';
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
  // Dedup guard: skip if identical treatment already exists
  const existing = await store.findTreatmentTrial(
    input.patientId,
    input.medication,
    input.startDate ?? null,
  );
  if (existing) {
    logger.debug(`captureData(treatment-trial): SKIP duplicate for ${input.patientId}`);
    return { success: true, id: existing };
  }

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
    source?: string;
  } = { id, patientId: input.patientId, medication: input.medication, efficacy: input.efficacy };
  if (input.drugClass) trial.drugClass = input.drugClass;
  if (input.indication) trial.indication = input.indication;
  if (input.startDate) trial.startDate = input.startDate;
  if (input.endDate) trial.endDate = input.endDate;
  if (input.dosage) trial.dosage = input.dosage;
  if (input.sideEffects) trial.sideEffects = input.sideEffects;
  if (input.reasonDiscontinued) trial.reasonDiscontinued = input.reasonDiscontinued;
  if (input.adequateTrial !== undefined) trial.adequateTrial = input.adequateTrial;
  trial.source = 'agent-captured';
  applyProvenance(trial as Record<string, unknown>, input);

  await store.addTreatmentTrial(trial);
  return { success: true, id };
}

async function handleConsultation(
  store: ClinicalStore,
  input: z.infer<typeof consultationData>,
): Promise<CaptureResult> {
  // Dedup guard: skip if identical consultation already exists
  const existing = await store.findConsultation(
    input.patientId,
    input.specialty,
    input.date,
    input.provider,
  );
  if (existing) {
    logger.debug(`captureData(consultation): SKIP duplicate for ${input.patientId}`);
    return { success: true, id: existing };
  }

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
    source?: string;
  } = {
    id,
    patientId: input.patientId,
    provider: input.provider,
    specialty: normalizeSpecialty(input.specialty),
    date: input.date,
    conclusionsStatus: input.conclusionsStatus,
  };
  if (input.institution) consultation.institution = input.institution;
  if (input.reason) consultation.reason = input.reason;
  if (input.findings) consultation.findings = input.findings;
  if (input.conclusions) consultation.conclusions = input.conclusions;
  if (input.recommendations) consultation.recommendations = input.recommendations;
  consultation.source = 'agent-captured';
  applyProvenance(consultation as Record<string, unknown>, input);

  await store.addConsultation(consultation);
  return { success: true, id };
}

async function handleResearchFinding(
  store: ClinicalStore,
  input: z.infer<typeof researchFindingData>,
): Promise<CaptureResult> {
  const id = generateId('finding');
  logger.debug(`captureData(research-finding): ${input.title} for ${input.patientId}`);

  const finding: {
    id: string;
    patientId: string;
    source: string;
    title: string;
    summary: string;
    date: string;
    sourceTool?: string;
    externalId?: string;
    externalIdType?: z.infer<typeof externalIdTypeEnum>;
    url?: string;
    relevance?: number;
    evidenceLevel?: z.infer<typeof evidenceLevelEnum>;
    researchQueryId?: string;
    rawData?: string;
  } = {
    id,
    patientId: input.patientId,
    source: input.source,
    title: input.title,
    summary: input.summary,
    date: todayDate(),
  };
  if (input.sourceTool) finding.sourceTool = input.sourceTool;
  if (input.externalId) finding.externalId = input.externalId;
  if (input.externalIdType) finding.externalIdType = input.externalIdType;
  if (input.url) finding.url = input.url;
  if (input.relevance !== undefined) finding.relevance = input.relevance;
  if (input.evidenceLevel) finding.evidenceLevel = input.evidenceLevel;
  if (input.researchQueryId) finding.researchQueryId = input.researchQueryId;
  if (input.rawData) finding.rawData = input.rawData;
  applyProvenance(finding as Record<string, unknown>, input);

  const result = await store.addResearchFinding(finding);
  return { success: true, id: result.id, duplicate: result.duplicate };
}

async function handleResearchQuery(
  store: ClinicalStore,
  input: z.infer<typeof researchQueryData>,
): Promise<CaptureResult> {
  const id = generateId('rquery');
  logger.debug(`captureData(research-query): ${input.query} for ${input.patientId}`);

  const rquery: {
    id: string;
    patientId: string;
    query: string;
    toolUsed: string;
    date: string;
    agent?: string;
    resultCount?: number;
    findingIds?: string[];
    synthesis?: string;
    gaps?: string[];
    suggestedFollowUp?: string[];
    stage?: number;
    durationMs?: number;
  } = {
    id,
    patientId: input.patientId,
    query: input.query,
    toolUsed: input.toolUsed,
    date: todayDate(),
  };
  if (input.agent) rquery.agent = input.agent;
  if (input.resultCount !== undefined) rquery.resultCount = input.resultCount;
  if (input.findingIds) rquery.findingIds = input.findingIds;
  if (input.synthesis) rquery.synthesis = input.synthesis;
  if (input.gaps) rquery.gaps = input.gaps;
  if (input.suggestedFollowUp) rquery.suggestedFollowUp = input.suggestedFollowUp;
  if (input.stage !== undefined) rquery.stage = input.stage;
  if (input.durationMs !== undefined) rquery.durationMs = input.durationMs;
  applyProvenance(rquery as Record<string, unknown>, input);

  await store.addResearchQuery(rquery);
  return { success: true, id };
}

async function handleHypothesis(
  store: ClinicalStore,
  input: z.infer<typeof hypothesisData>,
): Promise<CaptureResult> {
  const id = generateId('hyp');
  logger.debug(`captureData(hypothesis): ${input.name} for ${input.patientId}`);

  const hypothesis: {
    id: string;
    patientId: string;
    name: string;
    date: string;
    icdCode?: string;
    probabilityLow?: number;
    probabilityHigh?: number;
    advocateCase?: string;
    skepticCase?: string;
    arbiterVerdict?: string;
    evidenceTier?: 'T1' | 'T2' | 'T3';
    certaintyLevel?: z.infer<typeof certaintyLevelEnum>;
    stage?: number;
    version?: number;
  } = {
    id,
    patientId: input.patientId,
    name: input.name,
    date: todayDate(),
  };
  if (input.icdCode) hypothesis.icdCode = input.icdCode;
  if (input.probabilityLow !== undefined) hypothesis.probabilityLow = input.probabilityLow;
  if (input.probabilityHigh !== undefined) hypothesis.probabilityHigh = input.probabilityHigh;
  if (input.advocateCase) hypothesis.advocateCase = input.advocateCase;
  if (input.skepticCase) hypothesis.skepticCase = input.skepticCase;
  if (input.arbiterVerdict) hypothesis.arbiterVerdict = input.arbiterVerdict;
  if (input.hypothesisEvidenceTier) hypothesis.evidenceTier = input.hypothesisEvidenceTier;
  if (input.certaintyLevel) hypothesis.certaintyLevel = input.certaintyLevel;
  if (input.stage !== undefined) hypothesis.stage = input.stage;
  if (input.version !== undefined) hypothesis.version = input.version;
  // Apply standard provenance (validationStatus, sourceCredibility) but NOT evidenceTier
  // since hypothesis has its own T1/T2/T3 field
  const provenanceRecord = hypothesis as Record<string, unknown>;
  if (input.validationStatus) provenanceRecord['validationStatus'] = input.validationStatus;
  if (input.sourceCredibility !== undefined)
    provenanceRecord['sourceCredibility'] = input.sourceCredibility;

  const result = await store.addHypothesis(hypothesis);
  return { success: true, id: result.id, duplicate: result.duplicate };
}

// ─── Tool definition ─────────────────────────────────────────────────

export const captureDataTool = createTool({
  id: 'capture-data',
  description: `Capture structured clinical or research data. Use the "type" field to specify what kind of data:
- "patient-report": PROs, symptom updates, treatment responses, concerns, goals, functional status
- "agent-learning": Patterns, insights, temporal correlations, diagnostic clues, evidence gaps
- "contradiction": Conflicting findings with methods, dates, and resolution plans
- "lab-result": Lab values with units, reference ranges, and flags
- "treatment-trial": Medication trials with efficacy, drug class, side effects
- "consultation": Specialist visits with findings, conclusions status, recommendations
- "research-finding": Literature findings (PMIDs, trials, gene pathways) with external IDs and evidence levels
- "research-query": Research query audit trail with tool used, result count, synthesis, and gaps
- "hypothesis": Diagnostic hypotheses with probability ranges, advocate/skeptic cases, certainty levels`,
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
      case 'research-finding':
        return handleResearchFinding(store, parsed);
      case 'research-query':
        return handleResearchQuery(store, parsed);
      case 'hypothesis':
        return handleHypothesis(store, parsed);
    }
  },
});
