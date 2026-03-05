import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ClinicalStore } from '../storage/clinical-store.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';

/**
 * Layer 2 Query Tools — retrieves structured clinical data on demand.
 *
 * The agent calls these when the conversation requires detail beyond
 * the clinical dashboard (working memory). Progressive disclosure:
 * dashboard shows "WBC declining", queryLabsTool returns every value.
 */

// ─── Lab Query Helpers ──────────────────────────────────────────────────

interface LabInput {
  patientId: string;
  testName?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  computeTrend?: boolean | undefined;
}

function buildLabQuery(input: LabInput) {
  const query: { patientId: string; testName?: string; dateFrom?: string; dateTo?: string } = {
    patientId: input.patientId,
  };
  if (input.testName) query.testName = input.testName;
  if (input.dateFrom) query.dateFrom = input.dateFrom;
  if (input.dateTo) query.dateTo = input.dateTo;
  return query;
}

function mapLabToResult(l: {
  testName: string;
  value: number | string;
  unit: string;
  date: string;
  flag?: string | undefined;
  referenceRange?: string | undefined;
}) {
  const r: {
    testName: string;
    value: number | string;
    unit: string;
    date: string;
    flag?: string;
    referenceRange?: string;
  } = {
    testName: l.testName,
    value: l.value,
    unit: l.unit,
    date: l.date,
  };
  if (l.flag) r.flag = l.flag;
  if (l.referenceRange) r.referenceRange = l.referenceRange;
  return r;
}

async function fetchLabTrend(store: ClinicalStore, input: LabInput) {
  if (!input.testName) return undefined;
  const trendQuery: { patientId: string; testName: string; dateFrom?: string; dateTo?: string } = {
    patientId: input.patientId,
    testName: input.testName,
  };
  if (input.dateFrom) trendQuery.dateFrom = input.dateFrom;
  if (input.dateTo) trendQuery.dateTo = input.dateTo;

  const trendResult = await store.getLabTrends(trendQuery);
  if (!trendResult) return undefined;

  const trend: {
    direction: string;
    rateOfChange?: number;
    latestValue: number;
    latestDate: string;
    isAbnormal: boolean;
    clinicalNote?: string;
  } = {
    direction: trendResult.direction,
    latestValue: trendResult.latestValue,
    latestDate: trendResult.latestDate,
    isAbnormal: trendResult.isAbnormal,
  };
  if (trendResult.rateOfChange !== undefined) trend.rateOfChange = trendResult.rateOfChange;
  if (trendResult.clinicalNote) trend.clinicalNote = trendResult.clinicalNote;
  return trend;
}

// ─── Query Labs ─────────────────────────────────────────────────────────

export const queryLabsTool = createTool({
  id: 'query-labs',
  description:
    'Query patient lab results from the clinical record. Returns historical values with dates, reference ranges, and flags. Use when the patient asks about specific lab values, when you need trend data, or when investigating a clinical finding. Can filter by test name, date range, or flag status.',
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    testName: z
      .string()
      .optional()
      .describe('Filter by test name (e.g., "WBC", "CRP", "Anti-Ro-60")'),
    dateFrom: z.string().optional().describe('Start date filter (ISO 8601)'),
    dateTo: z.string().optional().describe('End date filter (ISO 8601)'),
    computeTrend: z
      .boolean()
      .optional()
      .describe('If true and testName is provided, compute trend analysis'),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        testName: z.string(),
        value: z.union([z.number(), z.string()]),
        unit: z.string(),
        date: z.string(),
        flag: z.string().optional(),
        referenceRange: z.string().optional(),
      }),
    ),
    trend: z
      .object({
        direction: z.string(),
        rateOfChange: z.number().optional(),
        latestValue: z.number(),
        latestDate: z.string(),
        isAbnormal: z.boolean(),
        clinicalNote: z.string().optional(),
      })
      .optional(),
    count: z.number(),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    logger.debug(`Querying labs for patient ${input.patientId}, test=${input.testName ?? 'all'}`);

    const labs = await store.queryLabs(buildLabQuery(input));
    const results = labs.map(mapLabToResult);

    const trend =
      input.computeTrend && input.testName ? await fetchLabTrend(store, input) : undefined;

    const output: { results: typeof results; count: number; trend?: typeof trend } = {
      results,
      count: labs.length,
    };
    if (trend) output.trend = trend;
    return output;
  },
});

// ─── Query Treatments ───────────────────────────────────────────────────

export const queryTreatmentsTool = createTool({
  id: 'query-treatments',
  description:
    'Query patient treatment history from the clinical record. Returns medications tried with efficacy ratings, drug classes, dosages, and reasons for discontinuation. Use when discussing treatment options, identifying exhausted pathways, or reviewing medication history.',
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    drugClass: z.string().optional().describe('Filter by drug class (e.g., "CGRP mAb", "SNRI")'),
    efficacy: z
      .string()
      .optional()
      .describe('Filter by efficacy (none/minimal/partial/significant/complete/unknown)'),
  }),
  outputSchema: z.object({
    trials: z.array(
      z.object({
        medication: z.string(),
        drugClass: z.string().optional(),
        efficacy: z.string(),
        dosage: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        sideEffects: z.array(z.string()).optional(),
        reasonDiscontinued: z.string().optional(),
        adequateTrial: z.boolean().optional(),
      }),
    ),
    count: z.number(),
    exhaustedClasses: z
      .array(z.string())
      .describe('Drug classes where all trials showed no efficacy'),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    logger.debug(`Querying treatments for patient ${input.patientId}`);

    const query: { patientId: string; drugClass?: string; efficacy?: string } = {
      patientId: input.patientId,
    };
    if (input.drugClass) query.drugClass = input.drugClass;
    if (input.efficacy) query.efficacy = input.efficacy;

    const treatments = await store.queryTreatments(query);

    const trials = treatments.map((t) => {
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
      } = {
        medication: t.medication,
        efficacy: t.efficacy,
      };
      if (t.drugClass) r.drugClass = t.drugClass;
      if (t.dosage) r.dosage = t.dosage;
      if (t.startDate) r.startDate = t.startDate;
      if (t.endDate) r.endDate = t.endDate;
      if (t.sideEffects) r.sideEffects = t.sideEffects;
      if (t.reasonDiscontinued) r.reasonDiscontinued = t.reasonDiscontinued;
      if (t.adequateTrial !== undefined) r.adequateTrial = t.adequateTrial;
      return r;
    });

    // Compute exhausted drug classes: classes where ALL trials had 'none' efficacy
    const classCounts = new Map<string, { total: number; failed: number }>();
    for (const t of treatments) {
      if (!t.drugClass) continue;
      const existing = classCounts.get(t.drugClass) ?? { total: 0, failed: 0 };
      existing.total++;
      if (t.efficacy === 'none') existing.failed++;
      classCounts.set(t.drugClass, existing);
    }

    const exhaustedClasses: string[] = [];
    for (const [cls, counts] of classCounts) {
      if (counts.total > 0 && counts.failed === counts.total) {
        exhaustedClasses.push(cls);
      }
    }

    return { trials, count: treatments.length, exhaustedClasses };
  },
});

// ─── Query Consultations ────────────────────────────────────────────────

export const queryConsultationsTool = createTool({
  id: 'query-consultations',
  description:
    'Query specialist consultation records. Returns provider details, findings, conclusions, and recommendations. Flags consultations with unknown/pending conclusions. Use when reviewing specialist opinions or identifying missing follow-up.',
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    specialty: z.string().optional().describe('Filter by specialty'),
    provider: z.string().optional().describe('Filter by provider name (partial match)'),
  }),
  outputSchema: z.object({
    consultations: z.array(
      z.object({
        provider: z.string(),
        specialty: z.string(),
        institution: z.string().optional(),
        date: z.string(),
        findings: z.string().optional(),
        conclusions: z.string().optional(),
        conclusionsStatus: z.string(),
        recommendations: z.array(z.string()).optional(),
      }),
    ),
    count: z.number(),
    missingConclusions: z
      .number()
      .describe('Number of consultations with unknown/pending conclusions'),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    logger.debug(`Querying consultations for patient ${input.patientId}`);

    const query: { patientId: string; specialty?: string; provider?: string } = {
      patientId: input.patientId,
    };
    if (input.specialty) query.specialty = input.specialty;
    if (input.provider) query.provider = input.provider;

    const consultations = await store.queryConsultations(query);

    const results = consultations.map((c) => {
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
      return r;
    });

    const missingConclusions = consultations.filter(
      (c) => c.conclusionsStatus === 'unknown' || c.conclusionsStatus === 'pending',
    ).length;

    return { consultations: results, count: consultations.length, missingConclusions };
  },
});

// ─── Query Contradictions ───────────────────────────────────────────────

export const queryContradictionsTool = createTool({
  id: 'query-contradictions',
  description:
    'Query contradictory or conflicting findings in the patient record. Returns finding pairs with methods, dates, resolution status, and diagnostic impact. Use when investigating discrepancies, planning resolution tests, or assessing diagnostic uncertainty.',
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    status: z
      .enum(['unresolved', 'pending', 'resolved'])
      .optional()
      .describe('Filter by resolution status'),
  }),
  outputSchema: z.object({
    contradictions: z.array(
      z.object({
        finding1: z.string(),
        finding1Date: z.string().optional(),
        finding1Method: z.string().optional(),
        finding2: z.string(),
        finding2Date: z.string().optional(),
        finding2Method: z.string().optional(),
        resolutionStatus: z.string(),
        resolutionPlan: z.string().optional(),
        diagnosticImpact: z.string().optional(),
      }),
    ),
    count: z.number(),
    unresolvedCount: z.number(),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    logger.debug(`Querying contradictions for patient ${input.patientId}`);

    const query: { patientId: string; status?: string } = {
      patientId: input.patientId,
    };
    if (input.status) query.status = input.status;

    const contradictions = await store.queryContradictions(query);

    const results = contradictions.map((c) => {
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
      } = {
        finding1: c.finding1,
        finding2: c.finding2,
        resolutionStatus: c.resolutionStatus,
      };
      if (c.finding1Date) r.finding1Date = c.finding1Date;
      if (c.finding1Method) r.finding1Method = c.finding1Method;
      if (c.finding2Date) r.finding2Date = c.finding2Date;
      if (c.finding2Method) r.finding2Method = c.finding2Method;
      if (c.resolutionPlan) r.resolutionPlan = c.resolutionPlan;
      if (c.diagnosticImpact) r.diagnosticImpact = c.diagnosticImpact;
      return r;
    });

    const unresolvedCount = contradictions.filter(
      (c) => c.resolutionStatus === 'unresolved',
    ).length;

    return { contradictions: results, count: contradictions.length, unresolvedCount };
  },
});

// ─── Query Patient History (Compound) ───────────────────────────────────

export const queryPatientHistoryTool = createTool({
  id: 'query-patient-history',
  description:
    'Retrieve a composite view of patient history: recent patient reports (PROs), agent learnings, and recent lab results in one call. Use at the start of a conversation or when you need a broad overview beyond the clinical dashboard.',
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    recentDays: z
      .number()
      .optional()
      .describe('Only include data from the last N days (default: 90)'),
  }),
  outputSchema: z.object({
    recentReports: z.array(
      z.object({
        date: z.string(),
        type: z.string(),
        content: z.string(),
        severity: z.number().optional(),
      }),
    ),
    learnings: z.array(
      z.object({
        category: z.string(),
        content: z.string(),
        confidence: z.number().optional(),
      }),
    ),
    recentLabs: z.array(
      z.object({
        testName: z.string(),
        value: z.union([z.number(), z.string()]),
        unit: z.string(),
        date: z.string(),
        flag: z.string().optional(),
      }),
    ),
    unresolvedContradictions: z.number(),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    const days = input.recentDays ?? 90;
    const cutoffDate =
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0] ?? '';

    logger.debug(`Querying composite history for patient ${input.patientId}, last ${days} days`);

    const [reports, learnings, labs, contradictions] = await Promise.all([
      store.queryPatientReports({ patientId: input.patientId, dateFrom: cutoffDate }),
      store.queryLearnings({ patientId: input.patientId }),
      store.queryLabs({ patientId: input.patientId, dateFrom: cutoffDate }),
      store.queryContradictions({ patientId: input.patientId, status: 'unresolved' }),
    ]);

    return {
      recentReports: reports.map((r) => {
        const out: { date: string; type: string; content: string; severity?: number } = {
          date: r.date,
          type: r.type,
          content: r.content,
        };
        if (r.severity !== undefined) out.severity = r.severity;
        return out;
      }),
      learnings: learnings.map((l) => {
        const out: { category: string; content: string; confidence?: number } = {
          category: l.category,
          content: l.content,
        };
        if (l.confidence !== undefined) out.confidence = l.confidence;
        return out;
      }),
      recentLabs: labs.map((l) => {
        const out: {
          testName: string;
          value: number | string;
          unit: string;
          date: string;
          flag?: string;
        } = {
          testName: l.testName,
          value: l.value,
          unit: l.unit,
          date: l.date,
        };
        if (l.flag) out.flag = l.flag;
        return out;
      }),
      unresolvedContradictions: contradictions.length,
    };
  },
});
