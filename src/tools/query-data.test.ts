import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ClinicalStore } from '../storage/clinical-store.js';

const TEST_PATIENT = 'patient-query-test';

/**
 * Tests for the consolidated queryData tool.
 * Verifies discriminated-union routing for all 5 query types.
 *
 * Seeds data via ClinicalStore, then queries via the tool to verify routing.
 *
 * Strategy: import the real ClinicalStore class directly, create an
 * in-memory store, then use jest.unstable_mockModule to intercept
 * getClinicalStore() so the tool reads from our in-memory store.
 * The tool module is dynamically imported AFTER the mock is registered.
 */

const store = new ClinicalStore('file::memory:?cache=shared');

jest.unstable_mockModule('../storage/clinical-store.js', () => ({
  ClinicalStore,
  getClinicalStore: () => store,
}));

// biome-ignore lint/suspicious/noExplicitAny: dynamically imported in beforeAll
let queryDataTool: any;

beforeAll(async () => {
  const mod = await import('./query-data.js');
  queryDataTool = mod.queryDataTool;
  await store.ensureInitialized();
  await seedTestData();
});

afterAll(async () => {
  await store.close();
});

async function seedTestData() {
  // Labs
  await store.addLabResult({
    id: 'lab-q-001',
    patientId: TEST_PATIENT,
    testName: 'WBC',
    value: 3.5,
    unit: 'tys/µl',
    referenceRange: '4.0-10.0',
    flag: 'low',
    date: '2019-08-29',
    source: 'Lab A',
  });
  await store.addLabResult({
    id: 'lab-q-002',
    patientId: TEST_PATIENT,
    testName: 'WBC',
    value: 4.37,
    unit: 'tys/µl',
    referenceRange: '4.0-10.0',
    flag: 'normal',
    date: '2022-03-15',
    source: 'Lab A',
  });
  await store.addLabResult({
    id: 'lab-q-003',
    patientId: TEST_PATIENT,
    testName: 'WBC',
    value: 2.59,
    unit: 'tys/µl',
    referenceRange: '4.0-10.0',
    flag: 'low',
    date: '2025-01-10',
    source: 'Lab B',
  });
  await store.addLabResult({
    id: 'lab-q-004',
    patientId: TEST_PATIENT,
    testName: 'CRP',
    value: 0.5,
    unit: 'mg/L',
    referenceRange: '0.0-5.0',
    flag: 'normal',
    date: '2025-01-10',
  });

  // Treatment trials
  await store.addTreatmentTrial({
    id: 'trial-q-001',
    patientId: TEST_PATIENT,
    medication: 'Erenumab',
    drugClass: 'CGRP mAb',
    efficacy: 'none',
    startDate: '2020-01-01',
    endDate: '2020-06-01',
    adequateTrial: true,
  });
  await store.addTreatmentTrial({
    id: 'trial-q-002',
    patientId: TEST_PATIENT,
    medication: 'Fremanezumab',
    drugClass: 'CGRP mAb',
    efficacy: 'none',
    startDate: '2020-07-01',
    endDate: '2020-12-01',
    adequateTrial: true,
  });
  await store.addTreatmentTrial({
    id: 'trial-q-003',
    patientId: TEST_PATIENT,
    medication: 'Pregabalin',
    drugClass: 'Anticonvulsant',
    efficacy: 'minimal',
    dosage: '150mg BID',
    sideEffects: ['dizziness', 'somnolence'],
  });

  // Consultations
  await store.addConsultation({
    id: 'consult-q-001',
    patientId: TEST_PATIENT,
    provider: 'Prof. Zakrzewska',
    specialty: 'Orofacial Pain',
    date: '2024-06-15',
    conclusionsStatus: 'unknown',
    reason: 'Trigeminal pain evaluation',
  });
  await store.addConsultation({
    id: 'consult-q-002',
    patientId: TEST_PATIENT,
    provider: 'Dr. Nowak',
    specialty: 'Rheumatology',
    date: '2025-02-20',
    conclusionsStatus: 'documented',
    findings: 'Anti-Ro-60 discrepancy',
    conclusions: 'Possible early Sjögren',
    recommendations: ['Repeat Anti-Ro-60', 'Schirmer test'],
  });

  // Contradictions
  await store.addContradiction({
    id: 'contra-q-001',
    patientId: TEST_PATIENT,
    finding1: 'Anti-Ro-60 positive (329.41 U/ml)',
    finding2: 'Anti-Ro-60 negative (ENA immunoblot)',
    finding1Date: '2025-01-15',
    finding2Date: '2025-01-20',
    finding1Method: 'Microblot',
    finding2Method: 'ENA immunoblot',
    resolutionStatus: 'unresolved',
  });
  await store.addContradiction({
    id: 'contra-q-002',
    patientId: TEST_PATIENT,
    finding1: 'Stable WBC in 2022',
    finding2: 'Dropping WBC in 2025',
    resolutionStatus: 'pending',
    resolutionPlan: 'Repeat CBC in 3 months',
  });

  // Patient reports
  const today = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
  await store.addPatientReport({
    id: 'report-q-001',
    patientId: TEST_PATIENT,
    date: today,
    type: 'symptom-update',
    content: 'Pain intensity increased to 8/10',
    severity: 8,
  });

  // Agent learnings
  await store.addAgentLearning({
    id: 'learn-q-001',
    patientId: TEST_PATIENT,
    date: today,
    category: 'diagnostic-clue',
    content: 'TCC convergence explains pain migration',
    confidence: 70,
  });
}

describe('queryDataTool', () => {
  it('has correct id and description', () => {
    expect(queryDataTool.id).toBe('query-data');
    expect(queryDataTool.description).toContain('labs');
    expect(queryDataTool.description).toContain('treatments');
    expect(queryDataTool.description).toContain('patient-history');
  });

  // ─── Labs Query ──────────────────────────────────────────────────

  describe('type: labs', () => {
    it('returns all labs for a patient', async () => {
      const result = await queryDataTool.execute({
        type: 'labs',
        patientId: TEST_PATIENT,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.count).toBeGreaterThanOrEqual(4);
      expect(data.results.length).toBe(data.count);
    });

    it('filters by test name', async () => {
      const result = await queryDataTool.execute({
        type: 'labs',
        patientId: TEST_PATIENT,
        testName: 'WBC',
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.count).toBe(3);
      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      expect(data.results.every((l: any) => l.testName === 'WBC')).toBe(true);
    });

    it('filters by date range', async () => {
      const result = await queryDataTool.execute({
        type: 'labs',
        patientId: TEST_PATIENT,
        testName: 'WBC',
        dateFrom: '2020-01-01',
        dateTo: '2023-12-31',
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.count).toBe(1);
      expect(data.results[0]?.value).toBe(4.37);
    });

    it('computes trend when requested', async () => {
      const result = await queryDataTool.execute({
        type: 'labs',
        patientId: TEST_PATIENT,
        testName: 'WBC',
        computeTrend: true,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.trend).toBeDefined();
      expect(data.trend.direction).toBe('fluctuating');
      expect(data.trend.latestValue).toBe(2.59);
      expect(data.trend.isAbnormal).toBe(true);
    });

    it('does not compute trend when computeTrend is false', async () => {
      const result = await queryDataTool.execute({
        type: 'labs',
        patientId: TEST_PATIENT,
        testName: 'WBC',
        computeTrend: false,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.trend).toBeUndefined();
    });

    it('returns empty results for non-existent patient', async () => {
      const result = await queryDataTool.execute({
        type: 'labs',
        patientId: 'non-existent-patient',
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.count).toBe(0);
      expect(data.results).toEqual([]);
    });
  });

  // ─── Treatments Query ────────────────────────────────────────────

  describe('type: treatments', () => {
    it('returns all treatment trials', async () => {
      const result = await queryDataTool.execute({
        type: 'treatments',
        patientId: TEST_PATIENT,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.count).toBe(3);
      expect(data.trials.length).toBe(3);
    });

    it('filters by drug class', async () => {
      const result = await queryDataTool.execute({
        type: 'treatments',
        patientId: TEST_PATIENT,
        drugClass: 'CGRP mAb',
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.count).toBe(2);
      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      expect(data.trials.every((t: any) => t.drugClass === 'CGRP mAb')).toBe(true);
    });

    it('computes exhausted drug classes', async () => {
      const result = await queryDataTool.execute({
        type: 'treatments',
        patientId: TEST_PATIENT,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.exhaustedClasses).toContain('CGRP mAb');
      expect(data.exhaustedClasses).not.toContain('Anticonvulsant');
    });

    it('includes trial details', async () => {
      const result = await queryDataTool.execute({
        type: 'treatments',
        patientId: TEST_PATIENT,
        drugClass: 'Anticonvulsant',
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.trials[0]?.medication).toBe('Pregabalin');
      expect(data.trials[0]?.dosage).toBe('150mg BID');
      expect(data.trials[0]?.sideEffects).toContain('dizziness');
    });
  });

  // ─── Consultations Query ─────────────────────────────────────────

  describe('type: consultations', () => {
    it('returns all consultations', async () => {
      const result = await queryDataTool.execute({
        type: 'consultations',
        patientId: TEST_PATIENT,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.count).toBe(2);
    });

    it('filters by specialty', async () => {
      const result = await queryDataTool.execute({
        type: 'consultations',
        patientId: TEST_PATIENT,
        specialty: 'Rheumatology',
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.count).toBe(1);
      expect(data.consultations[0]?.provider).toBe('Dr. Nowak');
    });

    it('filters by provider', async () => {
      const result = await queryDataTool.execute({
        type: 'consultations',
        patientId: TEST_PATIENT,
        provider: 'Prof. Zakrzewska',
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.count).toBe(1);
      expect(data.consultations[0]?.conclusionsStatus).toBe('unknown');
    });

    it('counts missing conclusions', async () => {
      const result = await queryDataTool.execute({
        type: 'consultations',
        patientId: TEST_PATIENT,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.missingConclusions).toBe(1);
    });
  });

  // ─── Contradictions Query ────────────────────────────────────────

  describe('type: contradictions', () => {
    it('returns all contradictions', async () => {
      const result = await queryDataTool.execute({
        type: 'contradictions',
        patientId: TEST_PATIENT,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.count).toBe(2);
    });

    it('filters by unresolved status', async () => {
      const result = await queryDataTool.execute({
        type: 'contradictions',
        patientId: TEST_PATIENT,
        status: 'unresolved',
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.count).toBe(1);
      expect(data.contradictions[0]?.finding1).toContain('Anti-Ro-60');
    });

    it('counts unresolved contradictions', async () => {
      const result = await queryDataTool.execute({
        type: 'contradictions',
        patientId: TEST_PATIENT,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.unresolvedCount).toBe(1);
    });

    it('includes resolution details when present', async () => {
      const result = await queryDataTool.execute({
        type: 'contradictions',
        patientId: TEST_PATIENT,
        status: 'pending',
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.count).toBe(1);
      expect(data.contradictions[0]?.resolutionPlan).toContain('Repeat CBC');
    });
  });

  // ─── Patient History Query ───────────────────────────────────────

  describe('type: patient-history', () => {
    it('returns composite view with default 90-day window', async () => {
      const result = await queryDataTool.execute({
        type: 'patient-history',
        patientId: TEST_PATIENT,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.recentReports).toBeDefined();
      expect(data.learnings).toBeDefined();
      expect(data.recentLabs).toBeDefined();
      expect(data.unresolvedContradictions).toBeDefined();
    });

    it('includes recent patient reports', async () => {
      const result = await queryDataTool.execute({
        type: 'patient-history',
        patientId: TEST_PATIENT,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.recentReports.length).toBeGreaterThanOrEqual(1);
      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const report = data.recentReports.find((r: any) => r.content.includes('Pain intensity'));
      expect(report).toBeDefined();
      expect(report?.severity).toBe(8);
    });

    it('includes agent learnings', async () => {
      const result = await queryDataTool.execute({
        type: 'patient-history',
        patientId: TEST_PATIENT,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.learnings.length).toBeGreaterThanOrEqual(1);
      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const learning = data.learnings.find((l: any) => l.content.includes('TCC convergence'));
      expect(learning).toBeDefined();
      expect(learning?.confidence).toBe(70);
    });

    it('counts unresolved contradictions', async () => {
      const result = await queryDataTool.execute({
        type: 'patient-history',
        patientId: TEST_PATIENT,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.unresolvedContradictions).toBe(1);
    });

    it('respects custom recentDays window', async () => {
      const result = await queryDataTool.execute({
        type: 'patient-history',
        patientId: TEST_PATIENT,
        recentDays: 1,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      const data = result.data as any;
      expect(data.recentReports.length).toBeGreaterThanOrEqual(1);
    });
  });
});
