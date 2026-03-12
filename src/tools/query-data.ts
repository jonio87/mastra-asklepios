import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { EvidenceTier, ValidationStatus } from '../schemas/clinical-record.js';
import { bodyRegionEnum, diagnosisStatusEnum } from '../schemas/diagnosis.js';
import { chromosomeEnum } from '../schemas/genetic-variant.js';
import { findingTypeEnum } from '../schemas/imaging-finding.js';
import { findingDomainEnum } from '../schemas/progression.js';
import { reportLanguageEnum } from '../schemas/report-version.js';
import {
  certaintyLevelEnum,
  evidenceLevelEnum,
  externalIdTypeEnum,
} from '../schemas/research-record.js';
import { extractionMethodEnum, sourceDocCategoryEnum } from '../schemas/source-document.js';
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
  flag?: string | undefined;
}

function buildLabQuery(input: LabQueryInput) {
  const query: {
    patientId: string;
    testName?: string;
    dateFrom?: string;
    dateTo?: string;
    flag?: string;
  } = {
    patientId: input.patientId,
  };
  if (input.testName) query.testName = input.testName;
  if (input.dateFrom) query.dateFrom = input.dateFrom;
  if (input.dateTo) query.dateTo = input.dateTo;
  if (input.flag) query.flag = input.flag;
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
  testName: z
    .string()
    .optional()
    .describe(
      'Filter by test name. Exact match by default. Use % for LIKE search (e.g., "%WBC%" matches "WBC", "WBC (urine dipstick)")',
    ),
  dateFrom: z.string().optional().describe('Start date (ISO 8601)'),
  dateTo: z.string().optional().describe('End date (ISO 8601)'),
  computeTrend: z.boolean().optional().describe('Compute trend analysis if testName provided'),
  flag: z.string().optional().describe('Filter by flag status (LOW, HIGH, normal, CRITICAL)'),
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

// ─── Research query schemas (Layer 2B) ──────────────────────────────

const findingsQuery = z.object({
  type: z.literal('findings'),
  patientId: z.string().describe('Patient resource ID'),
  source: z.string().optional().describe('Filter by source (e.g., "PubMed", "ClinicalTrials.gov")'),
  externalIdType: externalIdTypeEnum
    .optional()
    .describe('Filter by external ID type (pmid, nct, gene, etc.)'),
  evidenceLevel: evidenceLevelEnum.optional().describe('Filter by evidence level'),
  dateFrom: z.string().optional().describe('Start date (ISO 8601)'),
  dateTo: z.string().optional().describe('End date (ISO 8601)'),
  queryId: z.string().optional().describe('Filter by research query ID'),
});

const researchQueriesQuery = z.object({
  type: z.literal('research-queries'),
  patientId: z.string().describe('Patient resource ID'),
  toolUsed: z
    .string()
    .optional()
    .describe('Filter by tool (e.g., "deepResearch", "biomcp_article_searcher")'),
  agent: z.string().optional().describe('Filter by agent (e.g., "research-agent")'),
  stage: z.number().int().min(0).max(9).optional().describe('Filter by diagnostic flow stage'),
  dateFrom: z.string().optional().describe('Start date (ISO 8601)'),
  dateTo: z.string().optional().describe('End date (ISO 8601)'),
});

const hypothesesQuery = z.object({
  type: z.literal('hypotheses'),
  patientId: z.string().describe('Patient resource ID'),
  name: z.string().optional().describe('Filter by hypothesis name (LIKE search)'),
  certaintyLevel: certaintyLevelEnum.optional().describe('Filter by certainty level'),
  latestOnly: z
    .boolean()
    .optional()
    .describe('Only return latest non-superseded versions (default: true)'),
  withEvidence: z.boolean().optional().describe('Include linked evidence for each hypothesis'),
});

const hypothesisTimelineQuery = z.object({
  type: z.literal('hypothesis-timeline'),
  patientId: z.string().describe('Patient resource ID'),
  name: z.string().describe('Exact hypothesis name to trace through version history'),
});

const researchSummaryQuery = z.object({
  type: z.literal('research-summary'),
  patientId: z.string().describe('Patient resource ID'),
});

// ─── Genetic variant query schema (Layer 2C) ─────────────────────────

const geneticVariantsQuery = z.object({
  type: z.literal('genetic-variants'),
  patientId: z.string().describe('Patient resource ID'),
  chromosome: chromosomeEnum.optional().describe('Filter by chromosome (1-22, X, Y, MT)'),
  rsid: z.string().optional().describe('Filter by single rsid (e.g., "rs1800497")'),
  rsids: z
    .array(z.string())
    .optional()
    .describe('Batch lookup by multiple rsids (e.g., ["rs1800497", "rs4680"])'),
  positionFrom: z.number().int().optional().describe('Filter by position range (start)'),
  positionTo: z.number().int().optional().describe('Filter by position range (end)'),
  genotype: z.string().optional().describe('Filter by specific genotype (e.g., "AG", "TT")'),
  excludeNoCalls: z
    .boolean()
    .optional()
    .describe('Exclude no-call variants ("--" genotype, default: false)'),
  limit: z.number().int().positive().optional().describe('Max results (default: 100)'),
  offset: z.number().int().nonnegative().optional().describe('Pagination offset (default: 0)'),
});

// ─── Layer 0/2/5 query schemas ────────────────────────────────────────

const sourceDocumentsQuery = z.object({
  type: z.literal('source-documents'),
  patientId: z.string().describe('Patient resource ID'),
  category: sourceDocCategoryEnum.optional().describe('Filter by document category'),
  dateFrom: z.string().optional().describe('Start date (ISO 8601)'),
  dateTo: z.string().optional().describe('End date (ISO 8601)'),
  facility: z.string().optional().describe('Filter by facility'),
  extractionMethod: extractionMethodEnum.optional().describe('Filter by extraction method'),
  limit: z.number().int().positive().optional().describe('Max results'),
});

const imagingFindingsQuery = z.object({
  type: z.literal('imaging-findings'),
  patientId: z.string().describe('Patient resource ID'),
  anatomicalLocation: z.string().optional().describe('Filter by anatomical location (LIKE)'),
  findingType: findingTypeEnum.optional().describe('Filter by finding type'),
  imagingReportId: z.string().optional().describe('Filter by parent imaging report ID'),
  limit: z.number().int().positive().optional().describe('Max results'),
});

const diagnosesQuery = z.object({
  type: z.literal('diagnoses'),
  patientId: z.string().describe('Patient resource ID'),
  icd10Code: z.string().optional().describe('Filter by ICD-10 code'),
  currentStatus: diagnosisStatusEnum.optional().describe('Filter by diagnosis status'),
  bodyRegion: bodyRegionEnum.optional().describe('Filter by body region'),
  limit: z.number().int().positive().optional().describe('Max results'),
});

const progressionsQuery = z.object({
  type: z.literal('progressions'),
  patientId: z.string().describe('Patient resource ID'),
  findingChainId: z.string().optional().describe('Filter by finding chain ID'),
  findingName: z.string().optional().describe('Filter by finding name'),
  findingDomain: findingDomainEnum.optional().describe('Filter by domain (imaging, lab, etc.)'),
  anatomicalLocation: z.string().optional().describe('Filter by anatomical location'),
  dateFrom: z.string().optional().describe('Start date (ISO 8601)'),
  dateTo: z.string().optional().describe('End date (ISO 8601)'),
  limit: z.number().int().positive().optional().describe('Max results'),
});

const reportVersionsQuery = z.object({
  type: z.literal('report-versions'),
  patientId: z.string().describe('Patient resource ID'),
  reportName: z.string().optional().describe('Filter by report name'),
  language: reportLanguageEnum.optional().describe('Filter by language'),
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
  findingsQuery,
  researchQueriesQuery,
  hypothesesQuery,
  hypothesisTimelineQuery,
  researchSummaryQuery,
  geneticVariantsQuery,
  sourceDocumentsQuery,
  imagingFindingsQuery,
  diagnosesQuery,
  progressionsQuery,
  reportVersionsQuery,
]);

const queryDataInputSchema = z.object({
  type: z
    .enum([
      'labs',
      'treatments',
      'consultations',
      'contradictions',
      'patient-history',
      'findings',
      'research-queries',
      'hypotheses',
      'hypothesis-timeline',
      'research-summary',
      'genetic-variants',
      'source-documents',
      'imaging-findings',
      'diagnoses',
      'progressions',
      'report-versions',
    ])
    .describe('Type of clinical/research data to query'),
  patientId: z.string().describe('Patient resource ID'),
  // labs-specific fields
  testName: z
    .string()
    .optional()
    .describe(
      '(labs) Filter by test name. Exact match by default; use % for LIKE search (e.g., "%WBC%")',
    ),
  dateFrom: z
    .string()
    .optional()
    .describe('Start date (ISO 8601) — used by labs, findings, research-queries'),
  dateTo: z
    .string()
    .optional()
    .describe('End date (ISO 8601) — used by labs, findings, research-queries'),
  computeTrend: z
    .boolean()
    .optional()
    .describe('(labs) Compute trend analysis if testName provided'),
  flag: z
    .string()
    .optional()
    .describe('(labs) Filter by flag status (LOW, HIGH, normal, CRITICAL)'),
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
  // findings-specific fields
  source: z
    .string()
    .optional()
    .describe('(findings) Filter by source (e.g., "PubMed", "ClinicalTrials.gov")'),
  externalIdType: externalIdTypeEnum.optional().describe('(findings) Filter by external ID type'),
  evidenceLevel: evidenceLevelEnum.optional().describe('(findings) Filter by evidence level'),
  queryId: z.string().optional().describe('(findings) Filter by research query ID'),
  // research-queries-specific fields
  toolUsed: z.string().optional().describe('(research-queries) Filter by tool used'),
  agent: z.string().optional().describe('(research-queries) Filter by agent'),
  stage: z
    .number()
    .int()
    .min(0)
    .max(9)
    .optional()
    .describe('(research-queries) Filter by diagnostic flow stage'),
  // hypotheses-specific fields
  name: z.string().optional().describe('(hypotheses) Filter by hypothesis name (LIKE search)'),
  certaintyLevel: certaintyLevelEnum.optional().describe('(hypotheses) Filter by certainty level'),
  latestOnly: z
    .boolean()
    .optional()
    .describe('(hypotheses) Only return latest non-superseded versions (default: true)'),
  withEvidence: z
    .boolean()
    .optional()
    .describe('(hypotheses) Include linked evidence for each hypothesis'),
  // genetic-variants-specific fields
  chromosome: chromosomeEnum
    .optional()
    .describe('(genetic-variants) Filter by chromosome (1-22, X, Y, MT)'),
  rsid: z.string().optional().describe('(genetic-variants) Filter by single rsid'),
  rsids: z
    .array(z.string())
    .optional()
    .describe('(genetic-variants) Batch lookup by multiple rsids'),
  positionFrom: z
    .number()
    .int()
    .optional()
    .describe('(genetic-variants) Filter by position range start'),
  positionTo: z
    .number()
    .int()
    .optional()
    .describe('(genetic-variants) Filter by position range end'),
  genotype: z.string().optional().describe('(genetic-variants) Filter by specific genotype'),
  excludeNoCalls: z.boolean().optional().describe('(genetic-variants) Exclude no-call variants'),
  limit: z.number().int().positive().optional().describe('Max results (multiple types)'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('(genetic-variants) Pagination offset'),
  // source-documents-specific fields
  category: sourceDocCategoryEnum
    .optional()
    .describe('(source-documents) Filter by document category'),
  facility: z.string().optional().describe('(source-documents) Filter by facility'),
  extractionMethod: extractionMethodEnum
    .optional()
    .describe('(source-documents) Filter by extraction method'),
  // imaging-findings-specific fields
  anatomicalLocation: z
    .string()
    .optional()
    .describe('(imaging-findings/progressions) Filter by anatomical location'),
  findingType: findingTypeEnum.optional().describe('(imaging-findings) Filter by finding type'),
  imagingReportId: z
    .string()
    .optional()
    .describe('(imaging-findings) Filter by parent imaging report'),
  // diagnoses-specific fields
  icd10Code: z.string().optional().describe('(diagnoses) Filter by ICD-10 code'),
  currentStatus: diagnosisStatusEnum.optional().describe('(diagnoses) Filter by status'),
  bodyRegion: bodyRegionEnum.optional().describe('(diagnoses) Filter by body region'),
  // progressions-specific fields
  findingChainId: z.string().optional().describe('(progressions) Filter by finding chain ID'),
  findingName: z.string().optional().describe('(progressions) Filter by finding name'),
  findingDomain: findingDomainEnum
    .optional()
    .describe('(progressions) Filter by domain (imaging, lab, clinical, functional)'),
  // report-versions-specific fields
  reportName: z.string().optional().describe('(report-versions) Filter by report name'),
  language: reportLanguageEnum.optional().describe('(report-versions) Filter by language'),
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

// ─── Research query handlers (Layer 2B) ──────────────────────────────

async function handleFindingsQuery(
  store: ClinicalStore,
  input: z.infer<typeof findingsQuery>,
): Promise<{ data: unknown }> {
  logger.debug(`queryData(findings) for ${input.patientId}`);
  const query: {
    patientId: string;
    source?: string;
    externalIdType?: string;
    evidenceLevel?: string;
    dateFrom?: string;
    dateTo?: string;
    queryId?: string;
  } = { patientId: input.patientId };
  if (input.source) query.source = input.source;
  if (input.externalIdType) query.externalIdType = input.externalIdType;
  if (input.evidenceLevel) query.evidenceLevel = input.evidenceLevel;
  if (input.dateFrom) query.dateFrom = input.dateFrom;
  if (input.dateTo) query.dateTo = input.dateTo;
  if (input.queryId) query.queryId = input.queryId;

  const findings = await store.queryFindings(query);
  return { data: { findings, count: findings.length } };
}

async function handleResearchQueriesQuery(
  store: ClinicalStore,
  input: z.infer<typeof researchQueriesQuery>,
): Promise<{ data: unknown }> {
  logger.debug(`queryData(research-queries) for ${input.patientId}`);
  const query: {
    patientId: string;
    toolUsed?: string;
    agent?: string;
    stage?: number;
    dateFrom?: string;
    dateTo?: string;
  } = { patientId: input.patientId };
  if (input.toolUsed) query.toolUsed = input.toolUsed;
  if (input.agent) query.agent = input.agent;
  if (input.stage !== undefined) query.stage = input.stage;
  if (input.dateFrom) query.dateFrom = input.dateFrom;
  if (input.dateTo) query.dateTo = input.dateTo;

  const queries = await store.queryResearchQueries(query);
  return { data: { queries, count: queries.length } };
}

async function handleHypothesesQuery(
  store: ClinicalStore,
  input: z.infer<typeof hypothesesQuery>,
): Promise<{ data: unknown }> {
  logger.debug(`queryData(hypotheses) for ${input.patientId}`);
  const query: {
    patientId: string;
    name?: string;
    certaintyLevel?: string;
    latestOnly?: boolean;
  } = { patientId: input.patientId };
  if (input.name) query.name = input.name;
  if (input.certaintyLevel) query.certaintyLevel = input.certaintyLevel;
  if (input.latestOnly !== undefined) query.latestOnly = input.latestOnly;

  const hypotheses = await store.queryHypotheses(query);

  if (input.withEvidence) {
    const withEvidence = await Promise.all(
      hypotheses.map(async (h) => {
        const result = await store.getHypothesisWithEvidence(h.id);
        return { ...h, evidenceLinks: result?.links ?? [] };
      }),
    );
    return { data: { hypotheses: withEvidence, count: withEvidence.length } };
  }

  return { data: { hypotheses, count: hypotheses.length } };
}

async function handleHypothesisTimelineQuery(
  store: ClinicalStore,
  input: z.infer<typeof hypothesisTimelineQuery>,
): Promise<{ data: unknown }> {
  logger.debug(`queryData(hypothesis-timeline) for ${input.patientId}, name=${input.name}`);
  const timeline = await store.getHypothesisTimeline({
    patientId: input.patientId,
    name: input.name,
  });
  return { data: timeline };
}

async function handleResearchSummaryQuery(
  store: ClinicalStore,
  input: z.infer<typeof researchSummaryQuery>,
): Promise<{ data: unknown }> {
  logger.debug(`queryData(research-summary) for ${input.patientId}`);
  const summary = await store.getPatientResearchSummary(input.patientId);
  return { data: summary };
}

// ─── Genetic variant query handler (Layer 2C) ────────────────────────

async function handleGeneticVariantsQuery(
  store: ClinicalStore,
  input: z.infer<typeof geneticVariantsQuery>,
): Promise<{ data: unknown }> {
  logger.debug(
    `queryData(genetic-variants) for ${input.patientId}, chr=${input.chromosome ?? 'all'}`,
  );
  const variants = await store.queryGeneticVariants({
    patientId: input.patientId,
    chromosome: input.chromosome,
    rsid: input.rsid,
    rsids: input.rsids,
    positionFrom: input.positionFrom,
    positionTo: input.positionTo,
    genotype: input.genotype,
    excludeNoCalls: input.excludeNoCalls,
    limit: input.limit,
    offset: input.offset,
  });
  const total = await store.countGeneticVariants(input.patientId);

  return {
    data: {
      variants: variants.map((v) => ({
        rsid: v.rsid,
        chromosome: v.chromosome,
        position: v.position,
        genotype: v.genotype,
        source: v.source,
        referenceGenome: v.referenceGenome,
      })),
      count: variants.length,
      totalForPatient: total,
    },
  };
}

// ─── Layer 0/2/5 query handlers ──────────────────────────────────────

async function handleSourceDocumentsQuery(
  store: ClinicalStore,
  input: z.infer<typeof sourceDocumentsQuery>,
): Promise<{ data: unknown }> {
  logger.debug(
    `queryData(source-documents) for ${input.patientId}, cat=${input.category ?? 'all'}`,
  );
  const docs = await store.querySourceDocuments({
    patientId: input.patientId,
    category: input.category,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    facility: input.facility,
    extractionMethod: input.extractionMethod,
    limit: input.limit,
  });
  const categoryCounts = await store.getSourceDocumentsByCategory(input.patientId);
  const total = await store.countSourceDocuments(input.patientId);
  return { data: { documents: docs, count: docs.length, total, categoryCounts } };
}

async function handleImagingFindingsQuery(
  store: ClinicalStore,
  input: z.infer<typeof imagingFindingsQuery>,
): Promise<{ data: unknown }> {
  logger.debug(
    `queryData(imaging-findings) for ${input.patientId}, loc=${input.anatomicalLocation ?? 'all'}`,
  );
  const findings = await store.queryImagingFindings({
    patientId: input.patientId,
    anatomicalLocation: input.anatomicalLocation,
    findingType: input.findingType,
    imagingReportId: input.imagingReportId,
    limit: input.limit,
  });
  return { data: { findings, count: findings.length } };
}

async function handleDiagnosesQuery(
  store: ClinicalStore,
  input: z.infer<typeof diagnosesQuery>,
): Promise<{ data: unknown }> {
  logger.debug(`queryData(diagnoses) for ${input.patientId}`);
  const diagnoses = await store.queryDiagnoses({
    patientId: input.patientId,
    icd10Code: input.icd10Code,
    currentStatus: input.currentStatus,
    bodyRegion: input.bodyRegion,
    limit: input.limit,
  });
  return { data: { diagnoses, count: diagnoses.length } };
}

async function handleProgressionsQuery(
  store: ClinicalStore,
  input: z.infer<typeof progressionsQuery>,
): Promise<{ data: unknown }> {
  logger.debug(`queryData(progressions) for ${input.patientId}`);
  const progressions = await store.queryProgressions({
    patientId: input.patientId,
    findingChainId: input.findingChainId,
    findingName: input.findingName,
    findingDomain: input.findingDomain,
    anatomicalLocation: input.anatomicalLocation,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    limit: input.limit,
  });
  return { data: { progressions, count: progressions.length } };
}

async function handleReportVersionsQuery(
  store: ClinicalStore,
  input: z.infer<typeof reportVersionsQuery>,
): Promise<{ data: unknown }> {
  logger.debug(`queryData(report-versions) for ${input.patientId}`);
  const versions = await store.queryReportVersions(input.patientId);
  // Filter by reportName and language if provided
  let filtered = versions;
  if (input.reportName) {
    filtered = filtered.filter((v) => v.reportName === input.reportName);
  }
  if (input.language) {
    filtered = filtered.filter((v) => v.language === input.language);
  }
  return { data: { versions: filtered, count: filtered.length } };
}

// ─── Tool definition ─────────────────────────────────────────────────

export const queryDataTool = createTool({
  id: 'query-data',
  description: `Query structured clinical or research data from the patient record. Use the "type" field:
- "labs": Lab results with optional trend analysis (filter by testName, dateRange)
- "treatments": Treatment trials with efficacy and exhausted drug classes
- "consultations": Specialist visits with conclusions status
- "contradictions": Conflicting findings with resolution status
- "patient-history": Composite view (recent PROs + learnings + labs + unresolved contradictions)
- "findings": Research findings (PMIDs, trials, genes) with filters (source, externalIdType, evidenceLevel)
- "research-queries": Research query audit trail (filter by tool, agent, stage)
- "hypotheses": Diagnostic hypotheses with optional evidence links (filter by name, certaintyLevel)
- "hypothesis-timeline": Full version chain for a hypothesis — confidence evolution, direction changes, triggering evidence
- "research-summary": Aggregate research statistics (finding count, query count, hypothesis count, top sources)
- "genetic-variants": Raw genotype data (23andMe SNPs) — filter by chromosome, rsid, position range, genotype
- "source-documents": Layer 0 source documents with category counts and extraction metadata
- "imaging-findings": Structured imaging findings (decomposed from text blobs) — filter by location, type, report
- "diagnoses": Diagnosis registry with ICD-10, status, body region — the explicit diagnosis table
- "progressions": Temporal chains tracking same finding across dates — filter by chain, domain, location
- "report-versions": Report version history with content hash and change tracking`,
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
      case 'findings':
        return handleFindingsQuery(store, parsed);
      case 'research-queries':
        return handleResearchQueriesQuery(store, parsed);
      case 'hypotheses':
        return handleHypothesesQuery(store, parsed);
      case 'hypothesis-timeline':
        return handleHypothesisTimelineQuery(store, parsed);
      case 'research-summary':
        return handleResearchSummaryQuery(store, parsed);
      case 'genetic-variants':
        return handleGeneticVariantsQuery(store, parsed);
      case 'source-documents':
        return handleSourceDocumentsQuery(store, parsed);
      case 'imaging-findings':
        return handleImagingFindingsQuery(store, parsed);
      case 'diagnoses':
        return handleDiagnosesQuery(store, parsed);
      case 'progressions':
        return handleProgressionsQuery(store, parsed);
      case 'report-versions':
        return handleReportVersionsQuery(store, parsed);
    }
  },
});
