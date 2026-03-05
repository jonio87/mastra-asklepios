import type { ClinicalStore } from '../storage/clinical-store.js';
import { captureDataTool } from './capture-data.js';

const TEST_PATIENT = 'patient-capture-test';

/**
 * Tests for the consolidated captureData tool.
 * Verifies discriminated-union routing for all 6 capture types.
 *
 * Uses an in-memory SQLite database for isolation.
 */

// We need a store for verification queries — the tool uses getClinicalStore()
// which defaults to the file-based DB, but we can verify via the tool's output.
// For deeper verification, we query the same store the tool writes to.
let store: ClinicalStore;

// Mock getClinicalStore to use in-memory store
jest.mock('../storage/clinical-store.js', () => {
  const actual = jest.requireActual<typeof import('../storage/clinical-store.js')>(
    '../storage/clinical-store.js',
  );
  const memStore = new actual.ClinicalStore('file::memory:?cache=shared');
  return {
    ...actual,
    getClinicalStore: () => memStore,
    // biome-ignore lint/style/useNamingConvention: test export
    _testStore: memStore,
  };
});

beforeAll(async () => {
  // biome-ignore lint/suspicious/noExplicitAny: test helper access
  const mod = jest.requireMock('../storage/clinical-store.js') as any;
  store = mod._testStore;
  await store.ensureInitialized();
});

afterAll(async () => {
  await store.close();
});

describe('captureDataTool', () => {
  it('has correct id and description', () => {
    expect(captureDataTool.id).toBe('capture-data');
    expect(captureDataTool.description).toContain('patient-report');
    expect(captureDataTool.description).toContain('treatment-trial');
  });

  // ─── Patient Report ──────────────────────────────────────────────

  describe('type: patient-report', () => {
    it('captures a symptom update with minimal fields', async () => {
      const result = await captureDataTool.execute({
        type: 'patient-report',
        patientId: TEST_PATIENT,
        reportType: 'symptom-update',
        content: 'Pain migrated from occipital to right orbital region',
      });

      expect(result.success).toBe(true);
      expect(result.id).toMatch(/^pro-/);
    });

    it('captures a report with severity and insights', async () => {
      const result = await captureDataTool.execute({
        type: 'patient-report',
        patientId: TEST_PATIENT,
        reportType: 'treatment-response',
        content: 'Erenumab had no effect after 3 months',
        severity: 8,
        extractedInsights: ['CGRP pathway may be exhausted', 'Pain mechanism not peripheral'],
      });

      expect(result.success).toBe(true);
      expect(result.id).toMatch(/^pro-/);

      // Verify data was stored
      const reports = await store.queryPatientReports({ patientId: TEST_PATIENT });
      const found = reports.find((r) => r.content === 'Erenumab had no effect after 3 months');
      expect(found).toBeDefined();
      expect(found?.severity).toBe(8);
    });

    it('supports all report types', async () => {
      const types = ['concern', 'goal', 'functional-status', 'self-observation'] as const;

      for (const reportType of types) {
        const result = await captureDataTool.execute({
          type: 'patient-report',
          patientId: TEST_PATIENT,
          reportType,
          content: `Test ${reportType}`,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  // ─── Agent Learning ──────────────────────────────────────────────

  describe('type: agent-learning', () => {
    it('captures a diagnostic clue', async () => {
      const result = await captureDataTool.execute({
        type: 'agent-learning',
        patientId: TEST_PATIENT,
        category: 'diagnostic-clue',
        content: 'Pain migration from C2 to V1/V2 after GON block suggests TCC convergence',
      });

      expect(result.success).toBe(true);
      expect(result.id).toMatch(/^learn-/);
    });

    it('captures a learning with confidence and hypotheses', async () => {
      const result = await captureDataTool.execute({
        type: 'agent-learning',
        patientId: TEST_PATIENT,
        category: 'temporal-correlation',
        content: 'WBC decline correlates with autoimmune marker appearance',
        confidence: 65,
        relatedHypotheses: ['Sjögren syndrome', 'ANCA vasculitis'],
      });

      expect(result.success).toBe(true);

      const learnings = await store.queryLearnings({ patientId: TEST_PATIENT });
      const found = learnings.find((l) => l.content.includes('WBC decline correlates'));
      expect(found).toBeDefined();
      expect(found?.confidence).toBe(65);
    });

    it('supports all learning categories', async () => {
      const categories = [
        'pattern-noticed',
        'contradiction-found',
        'treatment-insight',
        'patient-behavior',
        'evidence-gap',
      ] as const;

      for (const category of categories) {
        const result = await captureDataTool.execute({
          type: 'agent-learning',
          patientId: TEST_PATIENT,
          category,
          content: `Test learning: ${category}`,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  // ─── Contradiction ───────────────────────────────────────────────

  describe('type: contradiction', () => {
    it('captures a contradiction with minimal fields', async () => {
      const result = await captureDataTool.execute({
        type: 'contradiction',
        patientId: TEST_PATIENT,
        finding1: 'Anti-Ro-60 positive (329.41 U/ml) on microblot',
        finding2: 'Anti-Ro-60 negative on ENA immunoblot 5 days later',
      });

      expect(result.success).toBe(true);
      expect(result.id).toMatch(/^contra-/);
    });

    it('auto-sets resolutionStatus to pending when plan is provided', async () => {
      const result = await captureDataTool.execute({
        type: 'contradiction',
        patientId: TEST_PATIENT,
        finding1: 'WBC stable in 2022',
        finding2: 'WBC dropping rapidly in 2025',
        finding1Date: '2022-03-15',
        finding2Date: '2025-01-10',
        finding1Method: 'CBC panel',
        finding2Method: 'CBC panel',
        resolutionPlan: 'Repeat CBC in 3 months, consider bone marrow biopsy',
        diagnosticImpact: 'Leukopenia trend supports systemic autoimmune process',
      });

      expect(result.success).toBe(true);

      const contradictions = await store.queryContradictions({ patientId: TEST_PATIENT });
      const found = contradictions.find((c) => c.finding1.includes('WBC stable'));
      expect(found).toBeDefined();
      expect(found?.resolutionStatus).toBe('pending');
    });

    it('auto-sets resolutionStatus to unresolved when no plan', async () => {
      const result = await captureDataTool.execute({
        type: 'contradiction',
        patientId: TEST_PATIENT,
        finding1: 'Finding A',
        finding2: 'Finding B',
      });

      expect(result.success).toBe(true);

      const contradictions = await store.queryContradictions({ patientId: TEST_PATIENT });
      const found = contradictions.find((c) => c.finding1 === 'Finding A');
      expect(found).toBeDefined();
      expect(found?.resolutionStatus).toBe('unresolved');
    });
  });

  // ─── Lab Result ──────────────────────────────────────────────────

  describe('type: lab-result', () => {
    it('captures a lab result with required fields', async () => {
      const result = await captureDataTool.execute({
        type: 'lab-result',
        patientId: TEST_PATIENT,
        testName: 'WBC',
        value: 2.59,
        unit: 'tys/µl',
        date: '2025-01-10',
      });

      expect(result.success).toBe(true);
      expect(result.id).toMatch(/^lab-/);
    });

    it('captures a lab result with all optional fields', async () => {
      const result = await captureDataTool.execute({
        type: 'lab-result',
        patientId: TEST_PATIENT,
        testName: 'CRP',
        value: 0.5,
        unit: 'mg/L',
        date: '2025-01-10',
        referenceRange: '0.0-5.0',
        flag: 'normal',
        source: 'Central Lab',
        notes: 'Fasting sample',
      });

      expect(result.success).toBe(true);

      const labs = await store.queryLabs({
        patientId: TEST_PATIENT,
        testName: 'CRP',
      });
      expect(labs.length).toBeGreaterThanOrEqual(1);
      const found = labs.find((l) => l.source === 'Central Lab');
      expect(found).toBeDefined();
      expect(found?.flag).toBe('normal');
    });

    it('accepts string values for lab results', async () => {
      const result = await captureDataTool.execute({
        type: 'lab-result',
        patientId: TEST_PATIENT,
        testName: 'Anti-Ro-60',
        value: 'positive (329.41 U/ml)',
        unit: 'qualitative',
        date: '2025-02-01',
      });

      expect(result.success).toBe(true);
    });
  });

  // ─── Treatment Trial ─────────────────────────────────────────────

  describe('type: treatment-trial', () => {
    it('captures a treatment trial with minimal fields', async () => {
      const result = await captureDataTool.execute({
        type: 'treatment-trial',
        patientId: TEST_PATIENT,
        medication: 'Erenumab',
        efficacy: 'none',
      });

      expect(result.success).toBe(true);
      expect(result.id).toMatch(/^trial-/);
    });

    it('captures a treatment trial with all optional fields', async () => {
      const result = await captureDataTool.execute({
        type: 'treatment-trial',
        patientId: TEST_PATIENT,
        medication: 'Pregabalin',
        efficacy: 'minimal',
        drugClass: 'Anticonvulsant',
        indication: 'Neuropathic pain',
        startDate: '2019-06-01',
        endDate: '2019-12-01',
        dosage: '150mg BID',
        sideEffects: ['dizziness', 'somnolence'],
        reasonDiscontinued: 'Insufficient efficacy with dose-limiting side effects',
        adequateTrial: true,
      });

      expect(result.success).toBe(true);

      const trials = await store.queryTreatments({ patientId: TEST_PATIENT });
      const found = trials.find((t) => t.medication === 'Pregabalin');
      expect(found).toBeDefined();
      expect(found?.efficacy).toBe('minimal');
      expect(found?.drugClass).toBe('Anticonvulsant');
      expect(found?.adequateTrial).toBe(true);
    });

    it('supports all efficacy levels', async () => {
      const levels = ['partial', 'significant', 'complete', 'unknown'] as const;

      for (const efficacy of levels) {
        const result = await captureDataTool.execute({
          type: 'treatment-trial',
          patientId: TEST_PATIENT,
          medication: `Test-${efficacy}`,
          efficacy,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  // ─── Consultation ────────────────────────────────────────────────

  describe('type: consultation', () => {
    it('captures a consultation with minimal fields', async () => {
      const result = await captureDataTool.execute({
        type: 'consultation',
        patientId: TEST_PATIENT,
        provider: 'Prof. Zakrzewska',
        specialty: 'Orofacial Pain',
        date: '2024-06-15',
        conclusionsStatus: 'unknown',
      });

      expect(result.success).toBe(true);
      expect(result.id).toMatch(/^consult-/);
    });

    it('captures a consultation with all optional fields', async () => {
      const result = await captureDataTool.execute({
        type: 'consultation',
        patientId: TEST_PATIENT,
        provider: 'Dr. Smith',
        specialty: 'Rheumatology',
        date: '2025-02-20',
        conclusionsStatus: 'documented',
        institution: 'University Hospital',
        reason: 'Evaluate autoimmune markers',
        findings: 'Anti-Ro-60 discrepancy, leukopenia',
        conclusions: 'Possible early Sjögren syndrome, recommend further testing',
        recommendations: [
          'Repeat Anti-Ro-60 with ELISA',
          'Schirmer test',
          'Minor salivary gland biopsy',
        ],
      });

      expect(result.success).toBe(true);

      const consultations = await store.queryConsultations({
        patientId: TEST_PATIENT,
        provider: 'Dr. Smith',
      });
      expect(consultations.length).toBeGreaterThanOrEqual(1);
      expect(consultations[0]?.conclusions).toContain('Sjögren');
    });

    it('supports all conclusionsStatus values', async () => {
      const statuses = ['documented', 'unknown', 'pending'] as const;

      for (const conclusionsStatus of statuses) {
        const result = await captureDataTool.execute({
          type: 'consultation',
          patientId: TEST_PATIENT,
          provider: `Test-${conclusionsStatus}`,
          specialty: 'Test',
          date: '2025-01-01',
          conclusionsStatus,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  // ─── Cross-cutting ───────────────────────────────────────────────

  describe('discriminated union routing', () => {
    it('generates unique IDs with correct prefixes per type', async () => {
      const ids: string[] = [];
      const types = [
        {
          type: 'patient-report' as const,
          reportType: 'concern' as const,
          content: 'test',
          prefix: 'pro-',
        },
        {
          type: 'agent-learning' as const,
          category: 'diagnostic-clue' as const,
          content: 'test',
          prefix: 'learn-',
        },
        { type: 'contradiction' as const, finding1: 'a', finding2: 'b', prefix: 'contra-' },
        {
          type: 'lab-result' as const,
          testName: 'X',
          value: 1,
          unit: 'u',
          date: '2025-01-01',
          prefix: 'lab-',
        },
        {
          type: 'treatment-trial' as const,
          medication: 'X',
          efficacy: 'unknown' as const,
          prefix: 'trial-',
        },
        {
          type: 'consultation' as const,
          provider: 'X',
          specialty: 'Y',
          date: '2025-01-01',
          conclusionsStatus: 'unknown' as const,
          prefix: 'consult-',
        },
      ];

      for (const { prefix, ...input } of types) {
        const result = await captureDataTool.execute({
          ...input,
          patientId: TEST_PATIENT,
        });
        expect(result.id).toMatch(new RegExp(`^${prefix}`));
        ids.push(result.id);
      }

      // All IDs should be unique
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });
  });
});
