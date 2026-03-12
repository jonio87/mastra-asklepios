import type {
  AgentLearning,
  Consultation,
  Contradiction,
  LabResult,
  PatientReport,
  TreatmentTrial,
} from '../schemas/clinical-record.js';
import { ClinicalStore } from './clinical-store.js';

const TEST_PATIENT = 'patient-test-001';

describe('ClinicalStore', () => {
  let store: ClinicalStore;

  beforeAll(async () => {
    // Use in-memory SQLite for test isolation
    store = new ClinicalStore('file::memory:?cache=shared');
    await store.ensureInitialized();
  });

  afterAll(async () => {
    await store.close();
  });

  // ─── Lab Results ──────────────────────────────────────────────────

  describe('lab results', () => {
    it('stores and retrieves a lab result', async () => {
      const lab: LabResult = {
        id: 'lab-test-001',
        testName: 'WBC',
        value: 3.5,
        unit: 'tys/µl',
        referenceRange: '4.0-10.0',
        flag: 'low',
        date: '2019-08-29',
        source: 'Diagnostyka Sp. z o.o.',
        patientId: TEST_PATIENT,
      };
      await store.addLabResult(lab);

      const results = await store.queryLabs({ patientId: TEST_PATIENT, testName: 'WBC' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      const found = results.find((r) => r.id === 'lab-test-001');
      expect(found).toBeDefined();
      expect(found?.value).toBe(3.5);
      expect(found?.flag).toBe('low');
    });

    it('filters by date range', async () => {
      await store.addLabResult({
        id: 'lab-test-002',
        testName: 'WBC',
        value: 4.37,
        unit: 'tys/µl',
        date: '2022-03-15',
        source: 'Test Lab',
        patientId: TEST_PATIENT,
      });
      await store.addLabResult({
        id: 'lab-test-002b',
        testName: 'WBC',
        value: 3.78,
        unit: 'tys/µl',
        date: '2023-11-20',
        source: 'Test Lab',
        patientId: TEST_PATIENT,
      });
      await store.addLabResult({
        id: 'lab-test-003',
        testName: 'WBC',
        value: 2.59,
        unit: 'tys/µl',
        flag: 'low',
        date: '2025-09-01',
        source: 'Test Lab',
        patientId: TEST_PATIENT,
      });

      const recent = await store.queryLabs({
        patientId: TEST_PATIENT,
        testName: 'WBC',
        dateFrom: '2024-01-01',
      });
      expect(recent.length).toBe(1);
      expect(recent[0]?.value).toBe(2.59);
    });

    it('filters by flag', async () => {
      const lowResults = await store.queryLabs({
        patientId: TEST_PATIENT,
        flag: 'low',
      });
      expect(lowResults.length).toBeGreaterThanOrEqual(2);
      for (const r of lowResults) {
        expect(r.flag).toBe('low');
      }
    });

    it('isolates by patient ID', async () => {
      await store.addLabResult({
        id: 'lab-other-001',
        testName: 'WBC',
        value: 7.0,
        unit: 'tys/µl',
        date: '2025-01-01',
        source: 'Test Lab',
        patientId: 'patient-other',
      });

      const results = await store.queryLabs({ patientId: TEST_PATIENT, testName: 'WBC' });
      const hasOther = results.some((r) => r.patientId === 'patient-other');
      expect(hasOther).toBe(false);
    });
  });

  // ─── Lab Trends ───────────────────────────────────────────────────

  describe('lab trends', () => {
    it('detects fluctuating WBC trend (up-then-down pattern)', async () => {
      // Data: 3.5 → 4.37 → 3.78 → 2.59 (1 increase + 2 decreases)
      // This is correctly classified as fluctuating due to the initial rise
      const trend = await store.getLabTrends({
        patientId: TEST_PATIENT,
        testName: 'WBC',
      });

      expect(trend).not.toBeNull();
      expect(trend?.testName).toBe('WBC');
      expect(trend?.direction).toBe('fluctuating');
      expect(trend?.latestValue).toBe(2.59);
      expect(trend?.isAbnormal).toBe(true);
    });

    it('detects a clearly falling trend', async () => {
      // Insert monotonically decreasing values
      await store.addLabResult({
        id: 'lab-hgb-001',
        testName: 'HGB',
        value: 14.0,
        unit: 'g/dL',
        date: '2020-01-01',
        source: 'Test Lab',
        patientId: TEST_PATIENT,
      });
      await store.addLabResult({
        id: 'lab-hgb-002',
        testName: 'HGB',
        value: 12.5,
        unit: 'g/dL',
        date: '2022-01-01',
        source: 'Test Lab',
        patientId: TEST_PATIENT,
      });
      await store.addLabResult({
        id: 'lab-hgb-003',
        testName: 'HGB',
        value: 11.0,
        unit: 'g/dL',
        flag: 'low',
        date: '2025-01-01',
        source: 'Test Lab',
        patientId: TEST_PATIENT,
      });

      const trend = await store.getLabTrends({
        patientId: TEST_PATIENT,
        testName: 'HGB',
      });
      expect(trend?.direction).toBe('falling');
      expect(trend?.isAbnormal).toBe(true);
    });

    it('returns null for a test with fewer than 2 values', async () => {
      await store.addLabResult({
        id: 'lab-single-001',
        testName: 'CRP',
        value: 5.2,
        unit: 'mg/L',
        date: '2025-01-01',
        source: 'Test Lab',
        patientId: TEST_PATIENT,
      });

      const trend = await store.getLabTrends({
        patientId: TEST_PATIENT,
        testName: 'CRP',
      });
      expect(trend).toBeNull();
    });

    it('computes rate of change in units per year', async () => {
      const trend = await store.getLabTrends({
        patientId: TEST_PATIENT,
        testName: 'WBC',
      });

      expect(trend?.rateOfChange).toBeDefined();
      // WBC went from 3.5 (2019-08) to 2.59 (2025-09) ≈ -0.15/year
      if (trend?.rateOfChange !== undefined) {
        expect(trend.rateOfChange).toBeLessThan(0);
      }
    });

    it('generates clinical notes for abnormal falling trends', async () => {
      const trend = await store.getLabTrends({
        patientId: TEST_PATIENT,
        testName: 'HGB',
      });

      expect(trend?.clinicalNote).toBeDefined();
      expect(trend?.clinicalNote).toContain('HGB');
      expect(trend?.clinicalNote).toContain('declining');
    });
  });

  // ─── Treatment Trials ─────────────────────────────────────────────

  describe('treatment trials', () => {
    it('stores and retrieves a treatment trial', async () => {
      const trial: TreatmentTrial = {
        id: 'trial-test-001',
        medication: 'Erenumab',
        drugClass: 'CGRP mAb',
        indication: 'headache prevention',
        startDate: '2023-01-15',
        endDate: '2023-07-15',
        dosage: '140mg monthly',
        efficacy: 'none',
        sideEffects: ['constipation'],
        reasonDiscontinued: 'No efficacy after 6 months',
        adequateTrial: true,
        patientId: TEST_PATIENT,
      };
      await store.addTreatmentTrial(trial);

      const results = await store.queryTreatments({ patientId: TEST_PATIENT });
      expect(results.length).toBeGreaterThanOrEqual(1);
      const found = results.find((r) => r.id === 'trial-test-001');
      expect(found).toBeDefined();
      expect(found?.medication).toBe('Erenumab');
      expect(found?.efficacy).toBe('none');
      expect(found?.sideEffects).toEqual(['constipation']);
      expect(found?.adequateTrial).toBe(true);
    });

    it('filters by drug class', async () => {
      await store.addTreatmentTrial({
        id: 'trial-test-002',
        medication: 'Fremanezumab',
        drugClass: 'CGRP mAb',
        efficacy: 'none',
        patientId: TEST_PATIENT,
      });
      await store.addTreatmentTrial({
        id: 'trial-test-003',
        medication: 'Amitriptyline',
        drugClass: 'TCA',
        efficacy: 'minimal',
        patientId: TEST_PATIENT,
      });

      const cgrp = await store.queryTreatments({ patientId: TEST_PATIENT, drugClass: 'CGRP mAb' });
      expect(cgrp.length).toBe(2);
      for (const t of cgrp) {
        expect(t.drugClass).toBe('CGRP mAb');
      }
    });

    it('filters by efficacy', async () => {
      const noneEfficacy = await store.queryTreatments({
        patientId: TEST_PATIENT,
        efficacy: 'none',
      });
      expect(noneEfficacy.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Consultations ────────────────────────────────────────────────

  describe('consultations', () => {
    it('stores and retrieves a consultation', async () => {
      const consultation: Consultation = {
        id: 'consult-test-001',
        provider: 'Prof. Joanna Zakrzewska',
        specialty: 'Orofacial Pain',
        institution: 'UCL Eastman Dental Institute',
        date: '2024-06-15',
        reason: 'Chronic trigeminal pain evaluation',
        conclusionsStatus: 'unknown',
        recommendations: ['EMG/NCS', 'Dynamic MRI'],
        patientId: TEST_PATIENT,
      };
      await store.addConsultation(consultation);

      const results = await store.queryConsultations({ patientId: TEST_PATIENT });
      expect(results.length).toBeGreaterThanOrEqual(1);
      const found = results.find((r) => r.id === 'consult-test-001');
      expect(found?.provider).toBe('Prof. Joanna Zakrzewska');
      expect(found?.conclusionsStatus).toBe('unknown');
      expect(found?.recommendations).toEqual(['EMG/NCS', 'Dynamic MRI']);
    });

    it('filters by specialty', async () => {
      await store.addConsultation({
        id: 'consult-test-002',
        provider: 'Dr. Neurolog',
        specialty: 'Neurology',
        date: '2025-01-01',
        conclusionsStatus: 'documented',
        patientId: TEST_PATIENT,
      });

      const neuro = await store.queryConsultations({
        patientId: TEST_PATIENT,
        specialty: 'Neurology',
      });
      expect(neuro.length).toBe(1);
      expect(neuro[0]?.specialty).toBe('Neurology');
    });

    it('searches by provider name (LIKE match)', async () => {
      const results = await store.queryConsultations({
        patientId: TEST_PATIENT,
        provider: 'Zakrzewska',
      });
      expect(results.length).toBe(1);
      expect(results[0]?.provider).toContain('Zakrzewska');
    });
  });

  // ─── Contradictions ───────────────────────────────────────────────

  describe('contradictions', () => {
    it('stores and retrieves the Anti-Ro-60 discrepancy', async () => {
      const contradiction: Contradiction = {
        id: 'contra-test-001',
        finding1: 'Anti-Ro-60 positive 329.41 U/ml',
        finding1Date: '2025-08-27',
        finding1Method: 'TestLine microblot',
        finding2: 'Anti-Ro-60 negative',
        finding2Date: '2025-09-01',
        finding2Method: 'Euroimmun immunoblot',
        resolutionStatus: 'unresolved',
        resolutionPlan: 'Third platform ELISA recommended',
        diagnosticImpact: 'Affects Sjögren hypothesis',
        patientId: TEST_PATIENT,
      };
      await store.addContradiction(contradiction);

      const results = await store.queryContradictions({ patientId: TEST_PATIENT });
      expect(results.length).toBe(1);
      expect(results[0]?.finding1).toContain('Anti-Ro-60 positive');
      expect(results[0]?.resolutionStatus).toBe('unresolved');
    });

    it('filters by resolution status', async () => {
      await store.addContradiction({
        id: 'contra-test-002',
        finding1: 'Medication A prescribed',
        finding2: 'Medication A not in patient log',
        resolutionStatus: 'resolved',
        patientId: TEST_PATIENT,
      });

      const unresolved = await store.queryContradictions({
        patientId: TEST_PATIENT,
        status: 'unresolved',
      });
      expect(unresolved.length).toBe(1);
      expect(unresolved[0]?.id).toBe('contra-test-001');
    });
  });

  // ─── Patient Reports (PROs) ───────────────────────────────────────

  describe('patient reports', () => {
    it('stores and retrieves a functional status report', async () => {
      const report: PatientReport = {
        id: 'pro-test-001',
        date: '2026-03-05',
        type: 'functional-status',
        content: "Can't hold phone for more than 2 minutes",
        severity: 7,
        extractedInsights: ['Fine motor weakness progressing'],
        patientId: TEST_PATIENT,
      };
      await store.addPatientReport(report);

      const results = await store.queryPatientReports({ patientId: TEST_PATIENT });
      expect(results.length).toBe(1);
      expect(results[0]?.type).toBe('functional-status');
      expect(results[0]?.severity).toBe(7);
      expect(results[0]?.extractedInsights).toEqual(['Fine motor weakness progressing']);
    });

    it('filters by type', async () => {
      await store.addPatientReport({
        id: 'pro-test-002',
        date: '2026-03-05',
        type: 'concern',
        content: 'Worried about the new weakness',
        patientId: TEST_PATIENT,
      });

      const concerns = await store.queryPatientReports({
        patientId: TEST_PATIENT,
        type: 'concern',
      });
      expect(concerns.length).toBe(1);
      expect(concerns[0]?.type).toBe('concern');
    });

    it('filters by date range', async () => {
      await store.addPatientReport({
        id: 'pro-test-003',
        date: '2025-01-01',
        type: 'symptom-update',
        content: 'Pain stable at 5/10',
        patientId: TEST_PATIENT,
      });

      const recent = await store.queryPatientReports({
        patientId: TEST_PATIENT,
        dateFrom: '2026-01-01',
      });
      expect(recent.length).toBe(2); // pro-test-001 and pro-test-002
    });
  });

  // ─── Agent Learnings ──────────────────────────────────────────────

  describe('agent learnings', () => {
    it('stores and retrieves a diagnostic clue', async () => {
      const learning: AgentLearning = {
        id: 'learn-test-001',
        date: '2026-03-05',
        category: 'diagnostic-clue',
        content: 'Pain MIGRATED not ADDED — pathognomonic for TCC',
        confidence: 85,
        relatedHypotheses: ['TCC', 'Central sensitization'],
        patientId: TEST_PATIENT,
      };
      await store.addAgentLearning(learning);

      const results = await store.queryLearnings({ patientId: TEST_PATIENT });
      expect(results.length).toBe(1);
      expect(results[0]?.category).toBe('diagnostic-clue');
      expect(results[0]?.confidence).toBe(85);
      expect(results[0]?.relatedHypotheses).toEqual(['TCC', 'Central sensitization']);
    });

    it('filters by category', async () => {
      await store.addAgentLearning({
        id: 'learn-test-002',
        date: '2026-03-05',
        category: 'evidence-gap',
        content: 'EMG/NCS never performed in 16 years',
        patientId: TEST_PATIENT,
      });

      const gaps = await store.queryLearnings({
        patientId: TEST_PATIENT,
        category: 'evidence-gap',
      });
      expect(gaps.length).toBe(1);
      expect(gaps[0]?.content).toContain('EMG/NCS');
    });
  });

  // ─── Idempotent Upsert ────────────────────────────────────────────

  describe('upsert behavior', () => {
    it('updates existing records on duplicate ID', async () => {
      await store.addLabResult({
        id: 'lab-upsert-001',
        testName: 'CRP',
        value: 5.0,
        unit: 'mg/L',
        date: '2025-01-01',
        source: 'Test Lab',
        patientId: TEST_PATIENT,
      });
      await store.addLabResult({
        id: 'lab-upsert-001',
        testName: 'CRP',
        value: 8.0,
        unit: 'mg/L',
        date: '2025-01-01',
        source: 'Test Lab',
        patientId: TEST_PATIENT,
      });

      const results = await store.queryLabs({ patientId: TEST_PATIENT, testName: 'CRP' });
      const found = results.filter((r) => r.id === 'lab-upsert-001');
      expect(found.length).toBe(1);
      expect(found[0]?.value).toBe(8.0);
    });
  });

  // ─── Dedup Finder Methods ─────────────────────────────────────────

  describe('dedup finders', () => {
    it('findConsultation returns ID when match exists', async () => {
      await store.addConsultation({
        id: 'dedup-con-001',
        provider: 'Dr. Finder',
        specialty: 'Neurology',
        date: '2025-06-01',
        conclusionsStatus: 'documented',
        patientId: TEST_PATIENT,
        source: 'test-dedup',
      });

      const found = await store.findConsultation(
        TEST_PATIENT,
        'Neurology',
        '2025-06-01',
        'Dr. Finder',
      );
      expect(found).toBe('dedup-con-001');
    });

    it('findConsultation returns null when no match', async () => {
      const found = await store.findConsultation(
        TEST_PATIENT,
        'Cardiology',
        '2030-01-01',
        'Dr. Nobody',
      );
      expect(found).toBeNull();
    });

    it('findTreatmentTrial returns ID when match exists', async () => {
      await store.addTreatmentTrial({
        id: 'dedup-trial-001',
        medication: 'Gabapentin',
        efficacy: 'minimal',
        startDate: '2024-01-15',
        drugClass: 'Anticonvulsant',
        patientId: TEST_PATIENT,
        source: 'test-dedup',
      });

      const found = await store.findTreatmentTrial(TEST_PATIENT, 'Gabapentin', '2024-01-15');
      expect(found).toBe('dedup-trial-001');
    });

    it('findContradiction returns ID when match exists', async () => {
      await store.addContradiction({
        id: 'dedup-contra-001',
        finding1: 'Test positive',
        finding2: 'Test negative',
        resolutionStatus: 'unresolved',
        patientId: TEST_PATIENT,
        source: 'test-dedup',
      });

      const found = await store.findContradiction(TEST_PATIENT, 'Test positive', 'Test negative');
      expect(found).toBe('dedup-contra-001');
    });

    it('findPatientReport returns ID when match exists', async () => {
      await store.addPatientReport({
        id: 'dedup-pro-001',
        date: '2025-07-01',
        type: 'concern',
        content: 'Unique dedup test content',
        patientId: TEST_PATIENT,
        source: 'test-dedup',
      });

      const found = await store.findPatientReport(
        TEST_PATIENT,
        'concern',
        'Unique dedup test content',
        '2025-07-01',
      );
      expect(found).toBe('dedup-pro-001');
    });

    it('findAgentLearning returns ID when match exists', async () => {
      await store.addAgentLearning({
        id: 'dedup-learn-001',
        date: '2025-07-01',
        category: 'diagnostic-clue',
        content: 'Unique learning for dedup test',
        patientId: TEST_PATIENT,
        source: 'test-dedup',
      });

      const found = await store.findAgentLearning(
        TEST_PATIENT,
        'diagnostic-clue',
        'Unique learning for dedup test',
      );
      expect(found).toBe('dedup-learn-001');
    });
  });
});
