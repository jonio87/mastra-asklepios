import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { EvidenceTier, ValidationStatus } from '../schemas/clinical-record.js';
import type { ClinicalStore } from '../storage/clinical-store.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';

/**
 * Consolidated query tool — single discriminated-union tool that replaces
 * 5 individual query tools. Reduces token overhead from ~3K to ~2K per call
 * by sending one tool schema instead of five.
 *
 * The agent specifies `type` to route the query to the correct handler.
 */

// ─── Provenance helper ──────────────────────────────────────────────

interface ProvenanceOutput {
  evidenceTier?: EvidenceTier;
  validationStatus?: ValidationStatus;
  sourceCredibility?: number;
}

function pickProvenance(row: {
  evidenceTier?: EvidenceTier | string | undefined;
  validationStatus?: ValidationStatus | string | undefined;
  sourceCredibility?: number | undefined;
}): ProvenanceOutput {
  const p: ProvenanceOutput = {};
  if (row.evidenceTier) p.evidenceTier = row.evidenceTier as EvidenceTier;
  if (row.validationStatus) p.validationStatus = row.validationStatus as ValidationStatus;
  if (row.sourceCredibility !== undefined) p.sourceCredibility = row.sourceCredibility;
  return p;
}

// ─── Lab query helpers ───────────────────────────────────────────────

interface LabQueryInput {
  patientId: string;
  testName?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

function buildLabQuery(input: LabQueryInput) {
  const query: { patientId: string; testName?: string; dateFrom?: string; dateTo?: string } = {
    patientId: input.patientId,
  };
  if (input.testName) query.testName = input.testName;
  if (input.dateFrom) query.dateFrom = input.dateFrom;
  if (input.dateTo) query.dateTo = input.dateTo;
  return query;
}

function mapLabRow(l: {
  testName: string;
  value: number | string;
  unit: string;
  date: string;
  flag?: string | undefined;
  referenceRange?: string | undefined;
  evidenceTier?: string | undefined;
  validationStatus?: string | undefined;
  sourceCredibility?: number | undefined;
}) {
  const r: {
    testName: string;
    value: number | string;
    unit: string;
    date: string;
    flag?: string;
    referenceRange?: string;
  } & ProvenanceOutput = { testName: l.testName, value: l.value, unit: l.unit, date: l.date };
  if (l.flag) r.flag = l.flag;
  if (l.referenceRange) r.referenceRange = l.referenceRange;
  return { ...r, ...pickProvenance(l) };
}

async function fetchLabTrend(store: ClinicalStore, input: LabQueryInput) {
  if (!input.testName) return undefined;
  const trendQuery: { patientId: string; testName: string; dateFrom?: string; dateTo?: string } = {
    patientId: input.patientId,
    testName: input.testName,
  };
  if (input.dateFrom) trendQuery.dateFrom = input.dateFrom;
  if (input.dateTo) trendQuery.dateTo = input.dateTo;

  const t = await store.getLabTrends(trendQuery);
  if (!t) return undefined;

  const trend: {
    direction: string;
    rateOfChange?: number;
    latestValue: number;
    latestDate: string;
    isAbnormal: boolean;
    clinicalNote?: string;
  } = {
    direction: t.direction,
    latestValue: t.latestValue,
    latestDate: t.latestDate,
    isAbnormal: t.isAbnormal,
  };
  if (t.rateOfChange !== undefined) trend.rateOfChange = t.rateOfChange;
  if (t.clinicalNote) trend.clinicalNote = t.clinicalNote;
  return trend;
}

// ─── Treatment row mapper ────────────────────────────────────────────

function mapTreatmentRow(t: {
  medication: string;
  efficacy: string;
  drugClass?: string | undefined;
  dosage?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  sideEffects?: string[] | undefined;
  reasonDiscontinued?: string | undefined;
  adequateTrial?: boolean | undefined;
  evidenceTier?: string | undefined;
  validationStatus?: string | undefined;
  sourceCredibility?: number | undefined;
}) {
  const r: {
    medication: string;
    drugClass?: string;
    efficacy: string;
    dosage?: string;
    startDate?: string;
    endDate?: string;
    sideEffects?: string[];
    reasonDiscontinued?: string;
    adequateTrial?: boolean;
  } = { medication: t.medication, efficacy: t.efficacy };
  if (t.drugClass) r.drugClass = t.drugClass;
  if (t.dosage) r.dosage = t.dosage;
  if (t.startDate) r.startDate = t.startDate;
  if (t.endDate) r.endDate = t.endDate;
  if (t.sideEffects) r.sideEffects = t.sideEffects;
  if (t.reasonDiscontinued) r.reasonDiscontinued = t.reasonDiscontinued;
  if (t.adequateTrial !== undefined) r.adequateTrial = t.adequateTrial;
  return { ...r, ...pickProvenance(t) };
}

// ─── Consultation row mapper ─────────────────────────────────────────

function mapConsultationRow(c: {
  provider: string;
  specialty: string;
  date: string;
  conclusionsStatus: string;
  institution?: string | undefined;
  findings?: string | undefined;
  conclusions?: string | undefined;
  recommendations?: string[] | undefined;
  evidenceTier?: string | undefined;
  validationStatus?: string | undefined;
  sourceCredibility?: number | undefined;
}) {
  const r: {
    provider: string;
    specialty: string;
    institution?: string;
    date: string;
    findings?: string;
    conclusions?: string;
    conclusionsStatus: string;
    recommendations?: string[];
  } = {
    provider: c.provider,
    specialty: c.specialty,
    date: c.date,
    conclusionsStatus: c.conclusionsStatus,
  };
  if (c.institution) r.institution = c.institution;
  if (c.findings) r.findings = c.findings;
  if (c.conclusions) r.conclusions = c.conclusions;
  if (c.recommendations) r.recommendations = c.recommendations;
  return { ...r, ...pickProvenance(c) };
}

// ─── Contradiction row mapper ────────────────────────────────────────

function mapContradictionRow(c: {
  finding1: string;
  finding2: string;
  resolutionStatus: string;
  finding1Date?: string | undefined;
  finding1Method?: string | undefined;
  finding2Date?: string | undefined;
  finding2Method?: string | undefined;
  resolutionPlan?: string | undefined;
  diagnosticImpact?: string | undefined;
  evidenceTier?: string | undefined;
  validationStatus?: string | undefined;
  sourceCredibility?: number | undefined;
}) {
  const r: {
    finding1: string;
    finding1Date?: string;
    finding1Method?: string;
    finding2: string;
    finding2Date?: string;
    finding2Method?: string;
    resolutionStatus: string;
    resolutionPlan?: string;
    diagnosticImpact?: string;
  } = { finding1: c.finding1, finding2: c.finding2, resolutionStatus: c.resolutionStatus };
  if (c.finding1Date) r.finding1Date = c.finding1Date;
  if (c.finding1Method) r.finding1Method = c.finding1Method;
  if (c.finding2Date) r.finding2Date = c.finding2Date;
  if (c.finding2Method) r.finding2Method = c.finding2Method;
  if (c.resolutionPlan) r.resolutionPlan = c.resolutionPlan;
  if (c.diagnosticImpact) r.diagnosticImpact = c.diagnosticImpact;
  return { ...r, ...pickProvenance(c) };
}

// ─── Exhausted drug class computation ────────────────────────────────

function computeExhaustedClasses(
  treatments: ReadonlyArray<{ drugClass?: string | undefined; efficacy: string }>,
): string[] {
  const classCounts = new Map<string, { total: number; failed: number }>();
  for (const t of treatments) {
    if (!t.drugClass) continue;
    const existing = classCounts.get(t.drugClass) ?? { total: 0, failed: 0 };
    existing.total++;
    if (t.efficacy === 'none') existing.failed++;
    classCounts.set(t.drugClass, existing);
  }
  const exhausted: string[] = [];
  for (const [cls, counts] of classCounts) {
    if (counts.total > 0 && counts.failed === counts.total) {
      exhausted.push(cls);
    }
  }
  return exhausted;
}

// ─── Discriminated union input schemas ───────────────────────────────

const labsQuery = z.object({
  type: z.literal('labs'),
  patientId: z.string().describe('Patient resource ID'),
  testName: z.string().optional().describe('Filter by test name (e.g., "WBC", "CRP")'),
  dateFrom: z.string().optional().describe('Start date (ISO 8601)'),
  dateTo: z.string().optional().describe('End date (ISO 8601)'),
  computeTrend: z.boolean().optional().describe('Compute trend analysis if testName provided'),
});

const treatmentsQuery = z.object({
  type: z.literal('treatments'),
  patientId: z.string().describe('Patient resource ID'),
  drugClass: z.string().optional().describe('Filter by drug class (e.g., "CGRP mAb")'),
  efficacy: z.string().optional().describe('Filter by efficacy'),
});

const consultationsQuery = z.object({
  type: z.literal('consultations'),
  patientId: z.string().describe('Patient resource ID'),
  specialty: z.string().optional().describe('Filter by specialty'),
  provider: z.string().optional().describe('Filter by provider name'),
});

const contradictionsQuery = z.object({
  type: z.literal('contradictions'),
  patientId: z.string().describe('Patient resource ID'),
  status: z
    .enum(['unresolved', 'pending', 'resolved'])
    .optional()
    .describe('Filter by resolution status'),
});

const patientHistoryQuery = z.object({
  type: z.literal('patient-history'),
  patientId: z.string().describe('Patient resource ID'),
  recentDays: z
    .number()
    .optional()
    .describe('Only include data from the last N days (default: 90)'),
});

/**
 * Keep the discriminated union for runtime parsing — it gives precise per-type validation.
 * But Anthropic's API rejects `oneOf` at the top level of tool `input_schema`,
 * so we also build a flat `z.object()` that produces `"type":"object"` in JSON Schema.
 */
const queryDataUnion = z.discriminatedUnion('type', [
  labsQuery,
  treatmentsQuery,
  consultationsQuery,
  contradictionsQuery,
  patientHistoryQuery,
]);

const queryDataInputSchema = z.object({
  type: z
    .enum(['labs', 'treatments', 'consultations', 'contradictions', 'patient-history'])
    .describe('Type of clinical data to query'),
  patientId: z.string().describe('Patient resource ID'),
  // labs-specific fields
  testName: z.string().optional().describe('(labs) Filter by test name (e.g., "WBC", "CRP")'),
  dateFrom: z.string().optional().describe('(labs) Start date (ISO 8601)'),
  dateTo: z.string().optional().describe('(labs) End date (ISO 8601)'),
  computeTrend: z
    .boolean()
    .optional()
    .describe('(labs) Compute trend analysis if testName provided'),
  // treatments-specific fields
  drugClass: z.string().optional().describe('(treatments) Filter by drug class (e.g., "CGRP mAb")'),
  efficacy: z.string().optional().describe('(treatments) Filter by efficacy'),
  // consultations-specific fields
  specialty: z.string().optional().describe('(consultations) Filter by specialty'),
  provider: z.string().optional().describe('(consultations) Filter by provider name'),
  // contradictions-specific fields
  status: z
    .enum(['unresolved', 'pending', 'resolved'])
    .optional()
    .describe('(contradictions) Filter by resolution status'),
  // patient-history-specific fields
  recentDays: z
    .number()
    .optional()
    .describe('(patient-history) Only include data from the last N days (default: 90)'),
});

// ─── Handler functions (one per query type) ──────────────────────────

async function handleLabsQuery(
  store: ClinicalStore,
  input: z.infer<typeof labsQuery>,
): Promise<{ data: unknown }> {
  logger.debug(`queryData(labs) for ${input.patientId}, test=${input.testName ?? 'all'}`);
  const labs = await store.queryLabs(buildLabQuery(input));
  const results = labs.map(mapLabRow);
  const trend =
    input.computeTrend && input.testName ? await fetchLabTrend(store, input) : undefined;

  const output: { results: typeof results; count: number; trend?: typeof trend } = {
    results,
    count: labs.length,
  };
  if (trend) output.trend = trend;
  return { data: output };
}

async function handleTreatmentsQuery(
  store: ClinicalStore,
  input: z.infer<typeof treatmentsQuery>,
): Promise<{ data: unknown }> {
  logger.debug(`queryData(treatments) for ${input.patientId}`);
  const query: { patientId: string; drugClass?: string; efficacy?: string } = {
    patientId: input.patientId,
  };
  if (input.drugClass) query.drugClass = input.drugClass;
  if (input.efficacy) query.efficacy = input.efficacy;

  const treatments = await store.queryTreatments(query);
  const trials = treatments.map(mapTreatmentRow);
  const exhaustedClasses = computeExhaustedClasses(treatments);

  return { data: { trials, count: treatments.length, exhaustedClasses } };
}

async function handleConsultationsQuery(
  store: ClinicalStore,
  input: z.infer<typeof consultationsQuery>,
): Promise<{ data: unknown }> {
  logger.debug(`queryData(consultations) for ${input.patientId}`);
  const query: { patientId: string; specialty?: string; provider?: string } = {
    patientId: input.patientId,
  };
  if (input.specialty) query.specialty = input.specialty;
  if (input.provider) query.provider = input.provider;

  const consultations = await store.queryConsultations(query);
  const results = consultations.map(mapConsultationRow);
  const missingConclusions = consultations.filter(
    (c) => c.conclusionsStatus === 'unknown' || c.conclusionsStatus === 'pending',
  ).length;

  return {
    data: { consultations: results, count: consultations.length, missingConclusions },
  };
}

async function handleContradictionsQuery(
  store: ClinicalStore,
  input: z.infer<typeof contradictionsQuery>,
): Promise<{ data: unknown }> {
  logger.debug(`queryData(contradictions) for ${input.patientId}`);
  const query: { patientId: string; status?: string } = { patientId: input.patientId };
  if (input.status) query.status = input.status;

  const contradictions = await store.queryContradictions(query);
  const results = contradictions.map(mapContradictionRow);
  const unresolvedCount = contradictions.filter((c) => c.resolutionStatus === 'unresolved').length;

  return { data: { contradictions: results, count: contradictions.length, unresolvedCount } };
}

async function handlePatientHistoryQuery(
  store: ClinicalStore,
  input: z.infer<typeof patientHistoryQuery>,
): Promise<{ data: unknown }> {
  const days = input.recentDays ?? 90;
  const cutoffDate =
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0] ?? '';
  logger.debug(`queryData(patient-history) for ${input.patientId}, last ${days} days`);

  const [reports, learnings, labs, contradictions] = await Promise.all([
    store.queryPatientReports({ patientId: input.patientId, dateFrom: cutoffDate }),
    store.queryLearnings({ patientId: input.patientId }),
    store.queryLabs({ patientId: input.patientId, dateFrom: cutoffDate }),
    store.queryContradictions({ patientId: input.patientId, status: 'unresolved' }),
  ]);

  return {
    data: {
      recentReports: reports.map((r) => {
        const out: { date: string; type: string; content: string; severity?: number } = {
          date: r.date,
          type: r.type,
          content: r.content,
        };
        if (r.severity !== undefined) out.severity = r.severity;
        return { ...out, ...pickProvenance(r) };
      }),
      learnings: learnings.map((l) => {
        const out: { category: string; content: string; confidence?: number } = {
          category: l.category,
          content: l.content,
        };
        if (l.confidence !== undefined) out.confidence = l.confidence;
        return { ...out, ...pickProvenance(l) };
      }),
      recentLabs: labs.map((l) => {
        const out: {
          testName: string;
          value: number | string;
          unit: string;
          date: string;
          flag?: string;
        } = { testName: l.testName, value: l.value, unit: l.unit, date: l.date };
        if (l.flag) out.flag = l.flag;
        return { ...out, ...pickProvenance(l) };
      }),
      unresolvedContradictions: contradictions.length,
    },
  };
}

// ─── Tool definition ─────────────────────────────────────────────────

export const queryDataTool = createTool({
  id: 'query-data',
  description: `Query structured clinical data from the patient record. Use the "type" field:
- "labs": Lab results with optional trend analysis (filter by testName, dateRange)
- "treatments": Treatment trials with efficacy and exhausted drug classes
- "consultations": Specialist visits with conclusions status
- "contradictions": Conflicting findings with resolution status
- "patient-history": Composite view (recent PROs + learnings + labs + unresolved contradictions)`,
  inputSchema: queryDataInputSchema,
  outputSchema: z.object({
    data: z.unknown().describe('Query results — shape depends on type'),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    // Re-parse through the discriminated union for precise per-type validation
    const parsed = queryDataUnion.parse(input);

    switch (parsed.type) {
      case 'labs':
        return handleLabsQuery(store, parsed);
      case 'treatments':
        return handleTreatmentsQuery(store, parsed);
      case 'consultations':
        return handleConsultationsQuery(store, parsed);
      case 'contradictions':
        return handleContradictionsQuery(store, parsed);
      case 'patient-history':
        return handlePatientHistoryQuery(store, parsed);
    }
  },
});
