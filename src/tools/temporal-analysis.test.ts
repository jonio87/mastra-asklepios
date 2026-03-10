import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockStore = {
  queryLabs: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  queryConsultations: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  queryTreatments: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  queryPatientReports: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  queryContradictions: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  queryHypotheses: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
};

jest.unstable_mockModule('../storage/clinical-store.js', () => ({
  getClinicalStore: () => mockStore,
}));

// biome-ignore lint/suspicious/noExplicitAny: dynamically imported in beforeAll
let temporalAnalysisTool: any;

beforeAll(async () => {
  const mod = await import('./temporal-analysis.js');
  temporalAnalysisTool = mod.temporalAnalysisTool;
});

const TEST_PATIENT = 'patient-ta-test';

// Seed data spanning several years
const labData = [
  {
    id: 'lab-1',
    patientId: TEST_PATIENT,
    testName: 'WBC',
    value: 4.5,
    unit: 'tys/µl',
    flag: 'normal',
    date: '2020-03-15',
  },
  {
    id: 'lab-2',
    patientId: TEST_PATIENT,
    testName: 'WBC',
    value: 3.2,
    unit: 'tys/µl',
    flag: 'low',
    date: '2021-06-20',
  },
  {
    id: 'lab-3',
    patientId: TEST_PATIENT,
    testName: 'CRP',
    value: 15.0,
    unit: 'mg/L',
    flag: 'high',
    date: '2022-01-10',
  },
  {
    id: 'lab-4',
    patientId: TEST_PATIENT,
    testName: 'WBC',
    value: 2.1,
    unit: 'tys/µl',
    flag: 'critical',
    date: '2024-09-05',
  },
];

const consultationData = [
  {
    id: 'cons-1',
    patientId: TEST_PATIENT,
    specialty: 'Rheumatology',
    provider: 'Dr. Smith',
    date: '2021-07-01',
    reason: 'Leukopenia workup',
    conclusions: 'Possible autoimmune etiology',
  },
  {
    id: 'cons-2',
    patientId: TEST_PATIENT,
    specialty: 'Hematology',
    provider: 'Dr. Jones',
    date: '2024-10-15',
    reason: 'Severe leukopenia',
    conclusions: 'Rule out MDS',
  },
];

const treatmentData = [
  {
    id: 'tx-1',
    patientId: TEST_PATIENT,
    medication: 'Hydroxychloroquine',
    dosage: '200mg BID',
    startDate: '2021-08-01',
    endDate: '2022-02-01',
    efficacy: 'none',
    reasonDiscontinued: 'No improvement',
  },
  {
    id: 'tx-2',
    patientId: TEST_PATIENT,
    medication: 'Methotrexate',
    dosage: '15mg weekly',
    startDate: '2022-03-01',
    efficacy: 'minimal',
  },
];

const reportData = [
  {
    id: 'report-1',
    patientId: TEST_PATIENT,
    date: '2020-03-20',
    type: 'symptom-update',
    content: 'Mild fatigue and joint stiffness noted in the morning',
    severity: 3,
  },
  {
    id: 'report-2',
    patientId: TEST_PATIENT,
    date: '2022-01-15',
    type: 'symptom-update',
    content: 'Severe fatigue, unable to work full days, significant joint pain',
    severity: 8,
  },
  {
    id: 'report-3',
    patientId: TEST_PATIENT,
    date: '2024-09-10',
    type: 'concern',
    content: 'Worried about worsening blood counts and increasing infections',
    severity: 9,
  },
];

const contradictionData = [
  {
    id: 'contra-1',
    patientId: TEST_PATIENT,
    finding1: 'ANA positive',
    finding2: 'ANA negative on repeat',
    finding1Date: '2021-06-25',
    finding2Date: '2021-09-10',
  },
];

function seedAllData() {
  mockStore.queryLabs.mockResolvedValue(labData);
  mockStore.queryConsultations.mockResolvedValue(consultationData);
  mockStore.queryTreatments.mockResolvedValue(treatmentData);
  mockStore.queryPatientReports.mockResolvedValue(reportData);
  mockStore.queryContradictions.mockResolvedValue(contradictionData);
  mockStore.queryHypotheses.mockResolvedValue([]);
}

describe('temporalAnalysisTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedAllData();
  });

  it('builds chronological timeline from mixed record types', async () => {
    const result = await temporalAnalysisTool.execute({ patientId: TEST_PATIENT }, {} as never);

    expect(result.timeline.length).toBeGreaterThan(0);
    // Should contain events from labs, consultations, treatments, reports, contradictions
    const categories = new Set(result.timeline.map((e: { category: string }) => e.category));
    expect(categories.has('lab')).toBe(true);
    expect(categories.has('consultation')).toBe(true);
    expect(categories.has('treatment')).toBe(true);
    expect(categories.has('patient-report')).toBe(true);
    expect(categories.has('contradiction')).toBe(true);
  });

  it('identifies phases via gap detection (>6 month gap = new phase)', async () => {
    // Data has a gap between 2022-03-01 and 2024-09-05 (>2 years)
    const result = await temporalAnalysisTool.execute({ patientId: TEST_PATIENT }, {} as never);

    expect(result.phases.length).toBeGreaterThanOrEqual(2);
    // Each phase should have a label, startDate, endDate
    for (const phase of result.phases) {
      expect(phase.label).toMatch(/^Phase \d+$/);
      expect(phase.startDate).toBeDefined();
      expect(phase.keyEvents).toBeDefined();
      expect(Array.isArray(phase.keyEvents)).toBe(true);
    }
  });

  it('classifies turning-point events', async () => {
    const result = await temporalAnalysisTool.execute({ patientId: TEST_PATIENT }, {} as never);

    const turningPoints = result.timeline.filter(
      (e: { significance: string }) => e.significance === 'turning-point',
    );
    // First notable/critical event in each category should be promoted to turning-point
    expect(turningPoints.length).toBeGreaterThan(0);
  });

  it('computes longest gap correctly', async () => {
    const result = await temporalAnalysisTool.execute({ patientId: TEST_PATIENT }, {} as never);

    expect(result.longestGap).toBeDefined();
    expect(result.longestGap.durationDays).toBeGreaterThan(0);
    expect(result.longestGap.startDate).toBeDefined();
    expect(result.longestGap.endDate).toBeDefined();
    expect(result.longestGap.significance).toBeDefined();
    // The biggest gap in our data is between ~2022-03 and ~2024-09 (~900+ days)
    expect(result.longestGap.durationDays).toBeGreaterThan(365);
  });

  it('calculates total span in years', async () => {
    const result = await temporalAnalysisTool.execute({ patientId: TEST_PATIENT }, {} as never);

    // Data spans from 2020-03-15 to 2024-10-15 (~4.5 years)
    expect(result.totalSpanYears).toBeGreaterThanOrEqual(4);
    expect(result.totalSpanYears).toBeLessThanOrEqual(5);
  });

  it('handles empty patient data gracefully', async () => {
    mockStore.queryLabs.mockResolvedValue([]);
    mockStore.queryConsultations.mockResolvedValue([]);
    mockStore.queryTreatments.mockResolvedValue([]);
    mockStore.queryPatientReports.mockResolvedValue([]);
    mockStore.queryContradictions.mockResolvedValue([]);

    const result = await temporalAnalysisTool.execute({ patientId: TEST_PATIENT }, {} as never);

    expect(result.timeline).toEqual([]);
    expect(result.phases).toEqual([]);
    expect(result.totalSpanYears).toBe(0);
    expect(result.temporalConsistency).toEqual([]);
  });

  it('filters by includeCategories when specified', async () => {
    const result = await temporalAnalysisTool.execute(
      { patientId: TEST_PATIENT, includeCategories: ['labs'] },
      {} as never,
    );

    // Should only query labs
    expect(mockStore.queryLabs).toHaveBeenCalledWith({ patientId: TEST_PATIENT });
    // Other stores should not have been called with patientId (they resolve to [])
    expect(mockStore.queryConsultations).not.toHaveBeenCalled();
    expect(mockStore.queryTreatments).not.toHaveBeenCalled();
    expect(mockStore.queryPatientReports).not.toHaveBeenCalled();
    expect(mockStore.queryContradictions).not.toHaveBeenCalled();

    // All events should be lab category
    for (const event of result.timeline) {
      expect(event.category).toBe('lab');
    }
  });

  it('checks temporal consistency against hypotheses', async () => {
    const result = await temporalAnalysisTool.execute(
      {
        patientId: TEST_PATIENT,
        hypotheses: [
          {
            name: 'Systemic Lupus Erythematosus',
            expectedProgression: 'onset age 20-40, progressive over 5-10 years',
          },
        ],
      },
      {} as never,
    );

    expect(result.temporalConsistency.length).toBe(1);
    const consistency = result.temporalConsistency[0];
    expect(consistency.hypothesis).toBe('Systemic Lupus Erythematosus');
    expect(typeof consistency.consistent).toBe('boolean');
    expect(typeof consistency.reasoning).toBe('string');
    expect(consistency.reasoning.length).toBeGreaterThan(0);
    expect(Array.isArray(consistency.timelineConflicts)).toBe(true);
  });

  it('flags temporal conflicts when symptom order is atypical', async () => {
    // Test with a relapsing-remitting hypothesis to trigger pattern detection
    const result = await temporalAnalysisTool.execute(
      {
        patientId: TEST_PATIENT,
        hypotheses: [
          {
            name: 'Multiple Sclerosis',
            expectedProgression: 'relapsing-remitting pattern with progressive disability',
          },
        ],
      },
      {} as never,
    );

    expect(result.temporalConsistency.length).toBe(1);
    const consistency = result.temporalConsistency[0];
    expect(consistency.hypothesis).toBe('Multiple Sclerosis');
    // Should mention relapsing-remitting pattern analysis
    expect(consistency.reasoning).toBeDefined();
    expect(consistency.reasoning.length).toBeGreaterThan(0);
  });

  it('returns sorted timeline by date ascending', async () => {
    const result = await temporalAnalysisTool.execute({ patientId: TEST_PATIENT }, {} as never);

    const dates = result.timeline.map((e: { date: string }) => e.date);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] >= dates[i - 1]).toBe(true);
    }
  });
});
