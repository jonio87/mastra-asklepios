import {
  agentLearningSchema,
  consultationSchema,
  contradictionSchema,
  labResultSchema,
  labTrendSchema,
  patientReportSchema,
  treatmentTrialSchema,
} from './clinical-record.js';

describe('labResultSchema', () => {
  it('accepts a numeric lab result', () => {
    const result = labResultSchema.safeParse({
      id: 'lab-001',
      testName: 'WBC',
      value: 2.59,
      unit: 'tys/µl',
      referenceRange: '4.0-10.0',
      flag: 'low',
      date: '2025-09-01',
      source: 'Diagnostyka Sp. z o.o.',
      patientId: 'patient-001',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a qualitative lab result', () => {
    const result = labResultSchema.safeParse({
      id: 'lab-002',
      testName: 'Anti-Ro-60',
      value: 'positive',
      unit: '',
      date: '2025-08-27',
      patientId: 'patient-001',
    });
    expect(result.success).toBe(true);
  });

  it('requires mandatory fields', () => {
    const result = labResultSchema.safeParse({
      id: 'lab-003',
      testName: 'CRP',
    });
    expect(result.success).toBe(false);
  });

  it('validates flag enum', () => {
    const invalid = labResultSchema.safeParse({
      id: 'lab-004',
      testName: 'CRP',
      value: 5,
      unit: 'mg/L',
      date: '2025-01-01',
      flag: 'danger',
      patientId: 'p1',
    });
    expect(invalid.success).toBe(false);
  });
});

describe('treatmentTrialSchema', () => {
  it('accepts a complete treatment trial', () => {
    const result = treatmentTrialSchema.safeParse({
      id: 'trial-001',
      medication: 'Erenumab',
      drugClass: 'CGRP mAb',
      indication: 'headache prevention',
      startDate: '2023-01-15',
      endDate: '2023-07-15',
      dosage: '140mg monthly',
      efficacy: 'none',
      sideEffects: ['constipation', 'injection site reaction'],
      reasonDiscontinued: 'No efficacy after 6 months',
      adequateTrial: true,
      patientId: 'patient-001',
    });
    expect(result.success).toBe(true);
  });

  it('validates efficacy enum', () => {
    for (const eff of [
      'none',
      'minimal',
      'partial',
      'significant',
      'complete',
      'unknown',
    ] as const) {
      const valid = treatmentTrialSchema.safeParse({
        id: 'trial-002',
        medication: 'Test',
        efficacy: eff,
        patientId: 'p1',
      });
      expect(valid.success).toBe(true);
    }

    const invalid = treatmentTrialSchema.safeParse({
      id: 'trial-003',
      medication: 'Test',
      efficacy: 'moderate',
      patientId: 'p1',
    });
    expect(invalid.success).toBe(false);
  });

  it('accepts minimal trial with only required fields', () => {
    const result = treatmentTrialSchema.safeParse({
      id: 'trial-004',
      medication: 'Amitriptyline',
      efficacy: 'minimal',
      patientId: 'patient-001',
    });
    expect(result.success).toBe(true);
  });
});

describe('consultationSchema', () => {
  it('accepts a complete consultation', () => {
    const result = consultationSchema.safeParse({
      id: 'consult-001',
      provider: 'Prof. Joanna Zakrzewska',
      specialty: 'Orofacial Pain',
      institution: 'UCL Eastman Dental Institute',
      date: '2024-06-15',
      reason: 'Chronic trigeminal pain evaluation',
      findings: 'Atypical pattern consistent with central sensitization',
      conclusionsStatus: 'unknown',
      recommendations: ['EMG/NCS', 'Dynamic MRI'],
      patientId: 'patient-001',
    });
    expect(result.success).toBe(true);
  });

  it('validates conclusionsStatus enum', () => {
    for (const status of ['documented', 'unknown', 'pending'] as const) {
      const valid = consultationSchema.safeParse({
        id: 'c1',
        provider: 'Dr. Test',
        specialty: 'Neurology',
        date: '2025-01-01',
        conclusionsStatus: status,
        patientId: 'p1',
      });
      expect(valid.success).toBe(true);
    }
  });
});

describe('contradictionSchema', () => {
  it('accepts the Anti-Ro-60 discrepancy scenario', () => {
    const result = contradictionSchema.safeParse({
      id: 'contra-001',
      finding1: 'Anti-Ro-60 positive 329.41 U/ml',
      finding1Date: '2025-08-27',
      finding1Method: 'TestLine 44-antigen microblot',
      finding2: 'Anti-Ro-60 negative',
      finding2Date: '2025-09-01',
      finding2Method: 'Euroimmun ENA immunoblot',
      resolutionStatus: 'unresolved',
      resolutionPlan: 'Third platform ELISA recommended',
      diagnosticImpact: 'Affects Sjögren hypothesis confidence (20-35%)',
      patientId: 'patient-001',
    });
    expect(result.success).toBe(true);
  });

  it('validates resolutionStatus enum', () => {
    const invalid = contradictionSchema.safeParse({
      id: 'c1',
      finding1: 'A',
      finding2: 'B',
      resolutionStatus: 'investigating',
      patientId: 'p1',
    });
    expect(invalid.success).toBe(false);
  });
});

describe('patientReportSchema', () => {
  it('accepts a functional status report', () => {
    const result = patientReportSchema.safeParse({
      id: 'pro-001',
      date: '2026-03-05',
      type: 'functional-status',
      content: "Can't hold phone for more than 2 minutes, hand goes numb",
      severity: 7,
      extractedInsights: ['Fine motor weakness progressing', 'Duration threshold: 2 minutes'],
      patientId: 'patient-001',
    });
    expect(result.success).toBe(true);
  });

  it('validates type enum', () => {
    const types = [
      'symptom-update',
      'treatment-response',
      'concern',
      'goal',
      'functional-status',
      'self-observation',
    ] as const;
    for (const t of types) {
      const valid = patientReportSchema.safeParse({
        id: 'p1',
        date: '2026-01-01',
        type: t,
        content: 'test',
        patientId: 'p1',
      });
      expect(valid.success).toBe(true);
    }
  });

  it('validates severity range (1-10)', () => {
    const tooLow = patientReportSchema.safeParse({
      id: 'p1',
      date: '2026-01-01',
      type: 'symptom-update',
      content: 'x',
      severity: 0,
      patientId: 'p1',
    });
    expect(tooLow.success).toBe(false);

    const tooHigh = patientReportSchema.safeParse({
      id: 'p1',
      date: '2026-01-01',
      type: 'symptom-update',
      content: 'x',
      severity: 11,
      patientId: 'p1',
    });
    expect(tooHigh.success).toBe(false);
  });
});

describe('agentLearningSchema', () => {
  it('accepts a diagnostic clue learning', () => {
    const result = agentLearningSchema.safeParse({
      id: 'learn-001',
      date: '2026-03-05',
      category: 'diagnostic-clue',
      content:
        'Pain MIGRATED not ADDED after GON block — pathognomonic for trigeminocervical convergence',
      confidence: 85,
      relatedHypotheses: ['TCC', 'Central sensitization'],
      patientId: 'patient-001',
    });
    expect(result.success).toBe(true);
  });

  it('validates category enum', () => {
    const categories = [
      'pattern-noticed',
      'contradiction-found',
      'treatment-insight',
      'patient-behavior',
      'temporal-correlation',
      'diagnostic-clue',
      'evidence-gap',
    ] as const;
    for (const cat of categories) {
      const valid = agentLearningSchema.safeParse({
        id: 'l1',
        date: '2026-01-01',
        category: cat,
        content: 'test',
        patientId: 'p1',
      });
      expect(valid.success).toBe(true);
    }
  });

  it('validates confidence range (0-100)', () => {
    const invalid = agentLearningSchema.safeParse({
      id: 'l1',
      date: '2026-01-01',
      category: 'evidence-gap',
      content: 'x',
      confidence: 150,
      patientId: 'p1',
    });
    expect(invalid.success).toBe(false);
  });
});

describe('labTrendSchema', () => {
  it('accepts a WBC trend analysis', () => {
    const result = labTrendSchema.safeParse({
      testName: 'WBC',
      values: [
        { date: '2019-08-29', value: 3.5, flag: 'low' },
        { date: '2022-03-15', value: 4.37 },
        { date: '2023-11-20', value: 3.78 },
        { date: '2025-09-01', value: 2.59, flag: 'low' },
      ],
      direction: 'falling',
      rateOfChange: -0.15,
      latestValue: 2.59,
      latestDate: '2025-09-01',
      isAbnormal: true,
      clinicalNote: 'WBC declining and currently abnormal; rate: 0.15 units/year decrease',
    });
    expect(result.success).toBe(true);
  });

  it('validates direction enum', () => {
    for (const dir of ['rising', 'falling', 'stable', 'fluctuating'] as const) {
      const valid = labTrendSchema.safeParse({
        testName: 'CRP',
        values: [{ date: '2025-01-01', value: 5 }],
        direction: dir,
        latestValue: 5,
        latestDate: '2025-01-01',
        isAbnormal: false,
      });
      expect(valid.success).toBe(true);
    }
  });
});
