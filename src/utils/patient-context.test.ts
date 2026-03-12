import { describe, expect, it, jest } from '@jest/globals';
import type {
  Consultation,
  Contradiction,
  LabResult,
  LabTrend,
  PatientReport,
  TreatmentTrial,
} from '../schemas/clinical-record.js';
import type {
  HypothesisEvidenceLink,
  ResearchFinding,
  ResearchHypothesis,
  ResearchSummary,
} from '../schemas/research-record.js';
import type { ClinicalStore } from '../storage/clinical-store.js';
import { buildPatientContext } from './patient-context.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

const PATIENT_ID = 'patient-001';

function makeLab(
  overrides: Partial<LabResult> & {
    id: string;
    testName: string;
    value: number | string;
    unit: string;
    date: string;
  },
): LabResult {
  return {
    patientId: PATIENT_ID,
    ...overrides,
  } as LabResult;
}

function makeTreatment(
  overrides: Partial<TreatmentTrial> & {
    id: string;
    medication: string;
    efficacy: TreatmentTrial['efficacy'];
  },
): TreatmentTrial {
  return {
    patientId: PATIENT_ID,
    ...overrides,
  } as TreatmentTrial;
}

function makeConsultation(
  overrides: Partial<Consultation> & {
    id: string;
    provider: string;
    specialty: string;
    date: string;
    conclusionsStatus: Consultation['conclusionsStatus'];
  },
): Consultation {
  return {
    patientId: PATIENT_ID,
    ...overrides,
  } as Consultation;
}

function makeContradiction(
  overrides: Partial<Contradiction> & {
    id: string;
    finding1: string;
    finding2: string;
    resolutionStatus: Contradiction['resolutionStatus'];
  },
): Contradiction {
  return {
    patientId: PATIENT_ID,
    ...overrides,
  } as Contradiction;
}

function makeReport(
  overrides: Partial<PatientReport> & {
    id: string;
    date: string;
    type: PatientReport['type'];
    content: string;
  },
): PatientReport {
  return {
    patientId: PATIENT_ID,
    ...overrides,
  } as PatientReport;
}

function makeHypothesis(
  overrides: Partial<ResearchHypothesis> & { id: string; name: string; date: string },
): ResearchHypothesis {
  return {
    patientId: PATIENT_ID,
    version: 1,
    ...overrides,
  } as ResearchHypothesis;
}

function makeResearchSummary(overrides?: Partial<ResearchSummary>): ResearchSummary {
  return {
    patientId: PATIENT_ID,
    findingCount: 0,
    queryCount: 0,
    hypothesisCount: 0,
    evidenceLinkCount: 0,
    topSources: [],
    ...overrides,
  };
}

function _makeFinding(
  overrides: Partial<ResearchFinding> & {
    id: string;
    title: string;
    source: string;
    date: string;
    summary: string;
  },
): ResearchFinding {
  return {
    patientId: PATIENT_ID,
    ...overrides,
  } as ResearchFinding;
}

function createMockStore(overrides?: {
  labs?: LabResult[];
  treatments?: TreatmentTrial[];
  consultations?: Consultation[];
  contradictions?: Contradiction[];
  reports?: PatientReport[];
  hypotheses?: ResearchHypothesis[];
  researchSummary?: ResearchSummary;
  labTrends?: Map<string, LabTrend | null>;
  hypothesisTimelines?: Map<
    string,
    {
      name: string;
      versions: Array<ResearchHypothesis & { evidenceLinks: HypothesisEvidenceLink[] }>;
      confidenceTrajectory: Array<{
        version: number;
        date: string;
        probabilityLow: number;
        probabilityHigh: number;
        certaintyLevel: string;
      }>;
      directionChanges: number;
    }
  >;
  findings?: ResearchFinding[];
}): ClinicalStore {
  const labs = overrides?.labs ?? [];
  const treatments = overrides?.treatments ?? [];
  const consultations = overrides?.consultations ?? [];
  const contradictions = overrides?.contradictions ?? [];
  const reports = overrides?.reports ?? [];
  const hypotheses = overrides?.hypotheses ?? [];
  const researchSummary = overrides?.researchSummary ?? makeResearchSummary();
  const labTrends = overrides?.labTrends ?? new Map<string, LabTrend | null>();
  const hypothesisTimelines = overrides?.hypothesisTimelines ?? new Map();
  const findings = overrides?.findings ?? [];

  return {
    queryLabs: jest.fn<Promise<LabResult[]>, [{ patientId: string }]>().mockResolvedValue(labs),
    queryTreatments: jest
      .fn<Promise<TreatmentTrial[]>, [{ patientId: string }]>()
      .mockResolvedValue(treatments),
    queryConsultations: jest
      .fn<Promise<Consultation[]>, [{ patientId: string }]>()
      .mockResolvedValue(consultations),
    queryContradictions: jest
      .fn<Promise<Contradiction[]>, [{ patientId: string }]>()
      .mockResolvedValue(contradictions),
    queryPatientReports: jest
      .fn<Promise<PatientReport[]>, [{ patientId: string }]>()
      .mockResolvedValue(reports),
    queryHypotheses: jest
      .fn<Promise<ResearchHypothesis[]>, [{ patientId: string }]>()
      .mockResolvedValue(hypotheses),
    getPatientResearchSummary: jest
      .fn<Promise<ResearchSummary>, [string]>()
      .mockResolvedValue(researchSummary),
    getLabTrends: jest
      .fn<Promise<LabTrend | null>, [{ patientId: string; testName: string }]>()
      .mockImplementation((params: { patientId: string; testName: string }) => {
        const trend = labTrends.get(params.testName);
        return Promise.resolve(trend === undefined ? null : trend);
      }),
    getHypothesisTimeline: jest
      .fn()
      .mockImplementation((params: { patientId: string; name: string }) => {
        const timeline = hypothesisTimelines.get(params.name);
        return Promise.resolve(
          timeline ?? {
            name: params.name,
            versions: [],
            confidenceTrajectory: [],
            directionChanges: 0,
          },
        );
      }),
    queryFindings: jest
      .fn<Promise<ResearchFinding[]>, [{ patientId: string; dateFrom?: string }]>()
      .mockResolvedValue(findings),
  } as unknown as ClinicalStore;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('buildPatientContext', () => {
  it('returns complete PatientContext with both tiers', async () => {
    const labs: LabResult[] = [
      makeLab({
        id: 'lab-1',
        testName: 'CRP',
        value: 12.5,
        unit: 'mg/L',
        date: '2024-01-10',
        flag: 'high',
      }),
      makeLab({
        id: 'lab-2',
        testName: 'WBC',
        value: 4.2,
        unit: 'K/uL',
        date: '2024-01-12',
        flag: 'normal',
      }),
    ];
    const treatments: TreatmentTrial[] = [
      makeTreatment({
        id: 'tx-1',
        medication: 'Erenumab',
        drugClass: 'CGRP mAb',
        efficacy: 'significant',
        startDate: '2024-01-01',
      }),
    ];
    const consultations: Consultation[] = [
      makeConsultation({
        id: 'con-1',
        provider: 'Dr. Smith',
        specialty: 'Neurology',
        date: '2024-01-15',
        conclusionsStatus: 'documented',
        conclusions: 'Migraine confirmed',
      }),
    ];
    const contradictions: Contradiction[] = [
      makeContradiction({
        id: 'ctr-1',
        finding1: 'Anti-Ro positive',
        finding2: 'Anti-Ro negative',
        resolutionStatus: 'unresolved',
        diagnosticImpact: 'Affects Sjögren hypothesis',
      }),
    ];
    const reports: PatientReport[] = [
      makeReport({
        id: 'rpt-1',
        date: '2024-01-20',
        type: 'symptom-update',
        content: 'Pain 8/10 today',
        severity: 8,
      }),
    ];
    const hypotheses: ResearchHypothesis[] = [
      makeHypothesis({
        id: 'hyp-1',
        name: 'Sjögren Syndrome',
        date: '2024-01-05',
        probabilityLow: 30,
        probabilityHigh: 60,
        certaintyLevel: 'MODERATE',
        advocateCase: 'Positive anti-Ro',
      }),
    ];
    const researchSummary = makeResearchSummary({
      findingCount: 5,
      queryCount: 3,
      hypothesisCount: 1,
      evidenceLinkCount: 2,
      topSources: [{ source: 'PubMed', count: 3 }],
      latestFindingDate: '2024-01-18',
    });

    const store = createMockStore({
      labs,
      treatments,
      consultations,
      contradictions,
      reports,
      hypotheses,
      researchSummary,
    });

    const ctx = await buildPatientContext(store, PATIENT_ID);

    // Top-level shape
    expect(ctx).toHaveProperty('tierA');
    expect(ctx).toHaveProperty('tierB');
    expect(ctx).toHaveProperty('generatedAt');
    expect(ctx).toHaveProperty('tokenEstimate');

    // Tier A
    expect(ctx.tierA.patientId).toBe(PATIENT_ID);
    expect(ctx.tierA.dataCompleteness.labCount).toBe(2);
    expect(ctx.tierA.dataCompleteness.consultationCount).toBe(1);
    expect(ctx.tierA.dataCompleteness.treatmentCount).toBe(1);
    expect(ctx.tierA.dataCompleteness.contradictionCount).toBe(1);
    expect(ctx.tierA.dataCompleteness.reportCount).toBe(1);
    expect(ctx.tierA.dataCompleteness.hasResearch).toBe(true);
    expect(ctx.tierA.researchState.findingCount).toBe(5);
    expect(ctx.tierA.researchState.hypothesisCount).toBe(1);
    expect(ctx.tierA.researchState.topSources).toEqual([{ source: 'PubMed', count: 3 }]);
    expect(ctx.tierA.currentHypotheses).toHaveLength(1);
    expect(ctx.tierA.currentHypotheses[0]?.name).toBe('Sjögren Syndrome');

    // Tier B
    expect(ctx.tierB.recentConsultations).toHaveLength(1);
    expect(ctx.tierB.recentConsultations[0]?.specialty).toBe('Neurology');
    expect(ctx.tierB.unresolvedContradictions).toHaveLength(1);
    expect(ctx.tierB.unresolvedContradictions[0]?.finding1).toBe('Anti-Ro positive');
  });

  it('handles empty patient data gracefully', async () => {
    const store = createMockStore();

    const ctx = await buildPatientContext(store, PATIENT_ID);

    expect(ctx.tierA.patientId).toBe(PATIENT_ID);
    expect(ctx.tierA.activeConcerns).toEqual([]);
    expect(ctx.tierA.currentHypotheses).toEqual([]);
    expect(ctx.tierA.criticalFindings).toEqual([]);
    expect(ctx.tierA.dataCompleteness).toEqual({
      labCount: 0,
      consultationCount: 0,
      treatmentCount: 0,
      contradictionCount: 0,
      reportCount: 0,
      hasResearch: false,
    });
    expect(ctx.tierA.treatmentLandscape).toEqual({
      totalTrials: 0,
      effectiveCount: 0,
      ineffectiveCount: 0,
      activeCount: 0,
      drugClassesTried: [],
    });
    expect(ctx.tierB.labTrends).toEqual([]);
    expect(ctx.tierB.temporalMap).toEqual([]);
    expect(ctx.tierB.hypothesisTimelines).toEqual([]);
    expect(ctx.tierB.unresolvedContradictions).toEqual([]);
    expect(ctx.tierB.recentConsultations).toEqual([]);
  });

  it('identifies critical lab values in criticalFindings', async () => {
    const labs: LabResult[] = [
      makeLab({
        id: 'lab-c1',
        testName: 'Potassium',
        value: 6.8,
        unit: 'mEq/L',
        date: '2024-02-01',
        flag: 'critical',
      }),
      makeLab({
        id: 'lab-c2',
        testName: 'Sodium',
        value: 120,
        unit: 'mEq/L',
        date: '2024-02-02',
        flag: 'critical',
      }),
      makeLab({
        id: 'lab-n1',
        testName: 'Glucose',
        value: 90,
        unit: 'mg/dL',
        date: '2024-02-03',
        flag: 'normal',
      }),
    ];

    const store = createMockStore({ labs });
    const ctx = await buildPatientContext(store, PATIENT_ID);

    expect(ctx.tierA.criticalFindings.length).toBeGreaterThanOrEqual(2);
    expect(ctx.tierA.criticalFindings.some((f) => f.includes('Potassium'))).toBe(true);
    expect(ctx.tierA.criticalFindings.some((f) => f.includes('Sodium'))).toBe(true);
    expect(ctx.tierA.criticalFindings.some((f) => f.includes('CRITICAL'))).toBe(true);
    // Normal lab should NOT appear in critical findings
    expect(ctx.tierA.criticalFindings.some((f) => f.includes('Glucose'))).toBe(false);
  });

  it('counts treatment effectiveness correctly', async () => {
    const treatments: TreatmentTrial[] = [
      makeTreatment({
        id: 'tx-1',
        medication: 'Drug A',
        efficacy: 'significant',
        endDate: '2024-01-30',
      }),
      makeTreatment({
        id: 'tx-2',
        medication: 'Drug B',
        efficacy: 'complete',
        endDate: '2024-02-15',
      }),
      makeTreatment({ id: 'tx-3', medication: 'Drug C', efficacy: 'none', endDate: '2024-03-01' }),
      makeTreatment({
        id: 'tx-4',
        medication: 'Drug D',
        efficacy: 'partial',
        endDate: '2024-03-15',
      }),
      makeTreatment({ id: 'tx-5', medication: 'Drug E', efficacy: 'minimal' }),
    ];

    const store = createMockStore({ treatments });
    const ctx = await buildPatientContext(store, PATIENT_ID);

    const landscape = ctx.tierA.treatmentLandscape;
    expect(landscape.totalTrials).toBe(5);
    // 'significant' + 'complete' = 2
    expect(landscape.effectiveCount).toBe(2);
    // 'none' = 1
    expect(landscape.ineffectiveCount).toBe(1);
  });

  it('identifies active treatments (no endDate)', async () => {
    const treatments: TreatmentTrial[] = [
      makeTreatment({ id: 'tx-a1', medication: 'Active Drug 1', efficacy: 'partial' }),
      makeTreatment({ id: 'tx-a2', medication: 'Active Drug 2', efficacy: 'significant' }),
      makeTreatment({
        id: 'tx-d1',
        medication: 'Discontinued Drug',
        efficacy: 'none',
        endDate: '2024-01-15',
      }),
    ];

    const store = createMockStore({ treatments });
    const ctx = await buildPatientContext(store, PATIENT_ID);

    // Two treatments without endDate = 2 active
    expect(ctx.tierA.treatmentLandscape.activeCount).toBe(2);
  });

  it('extracts drug classes from treatments', async () => {
    const treatments: TreatmentTrial[] = [
      makeTreatment({
        id: 'tx-dc1',
        medication: 'Erenumab',
        drugClass: 'CGRP mAb',
        efficacy: 'significant',
      }),
      makeTreatment({
        id: 'tx-dc2',
        medication: 'Fremanezumab',
        drugClass: 'CGRP mAb',
        efficacy: 'partial',
      }),
      makeTreatment({
        id: 'tx-dc3',
        medication: 'Pregabalin',
        drugClass: 'Anticonvulsant',
        efficacy: 'none',
      }),
      makeTreatment({
        id: 'tx-dc4',
        medication: 'Amitriptyline',
        drugClass: 'TCA',
        efficacy: 'minimal',
      }),
      makeTreatment({ id: 'tx-dc5', medication: 'Aspirin', efficacy: 'unknown' }), // no drugClass
    ];

    const store = createMockStore({ treatments });
    const ctx = await buildPatientContext(store, PATIENT_ID);

    const classes = ctx.tierA.treatmentLandscape.drugClassesTried;
    expect(classes).toContain('CGRP mAb');
    expect(classes).toContain('Anticonvulsant');
    expect(classes).toContain('TCA');
    // Unique — CGRP mAb should appear only once
    expect(classes.filter((c) => c === 'CGRP mAb')).toHaveLength(1);
    // 3 unique classes total
    expect(classes).toHaveLength(3);
  });

  it('detects unresolved contradictions in activeConcerns', async () => {
    const contradictions: Contradiction[] = [
      makeContradiction({
        id: 'ctr-u1',
        finding1: 'A',
        finding2: 'B',
        resolutionStatus: 'unresolved',
      }),
      makeContradiction({
        id: 'ctr-u2',
        finding1: 'C',
        finding2: 'D',
        resolutionStatus: 'pending',
      }),
      makeContradiction({
        id: 'ctr-r1',
        finding1: 'E',
        finding2: 'F',
        resolutionStatus: 'resolved',
      }),
    ];

    const store = createMockStore({ contradictions });
    const ctx = await buildPatientContext(store, PATIENT_ID);

    // activeConcerns should mention unresolved contradictions
    const contradictionConcern = ctx.tierA.activeConcerns.find((c) =>
      c.concern.includes('unresolved contradiction'),
    );
    expect(contradictionConcern).toBeDefined();
    // 'unresolved' + 'pending' = 2 unresolved
    expect(contradictionConcern?.concern).toContain('2');

    // Tier B unresolvedContradictions should include unresolved + pending, not resolved
    expect(ctx.tierB.unresolvedContradictions).toHaveLength(2);
    expect(ctx.tierB.unresolvedContradictions.some((c) => c.finding1 === 'A')).toBe(true);
    expect(ctx.tierB.unresolvedContradictions.some((c) => c.finding1 === 'C')).toBe(true);
    expect(ctx.tierB.unresolvedContradictions.some((c) => c.finding1 === 'E')).toBe(false);
  });

  it('builds lab trends for flagged tests', async () => {
    const labs: LabResult[] = [
      makeLab({
        id: 'lt-1',
        testName: 'CRP',
        value: 5.0,
        unit: 'mg/L',
        date: '2024-01-01',
        flag: 'high',
      }),
      makeLab({
        id: 'lt-2',
        testName: 'CRP',
        value: 8.0,
        unit: 'mg/L',
        date: '2024-02-01',
        flag: 'high',
      }),
    ];

    const crpTrend: LabTrend = {
      testName: 'CRP',
      values: [
        { date: '2024-01-01', value: 5.0, flag: 'high' },
        { date: '2024-02-01', value: 8.0, flag: 'high' },
      ],
      direction: 'rising',
      rateOfChange: 36,
      latestValue: 8.0,
      latestDate: '2024-02-01',
      isAbnormal: true,
      clinicalNote: 'CRP rising — monitor inflammation',
    };

    const labTrends = new Map<string, LabTrend | null>();
    labTrends.set('CRP', crpTrend);

    const store = createMockStore({ labs, labTrends });
    const ctx = await buildPatientContext(store, PATIENT_ID);

    expect(ctx.tierB.labTrends).toHaveLength(1);
    const trend = ctx.tierB.labTrends[0];
    expect(trend).toBeDefined();
    expect(trend?.testName).toBe('CRP');
    expect(trend?.direction).toBe('rising');
    expect(trend?.rateOfChange).toBe(36);
    expect(trend?.clinicalNote).toBe('CRP rising — monitor inflammation');
    expect(trend?.latestValue).toBe('8');
    expect(trend?.latestDate).toBe('2024-02-01');
    expect(trend?.dataPoints).toBe(2);
  });

  it('builds hypothesis timelines', async () => {
    const hypotheses: ResearchHypothesis[] = [
      makeHypothesis({
        id: 'hyp-t1',
        name: 'GPA',
        date: '2024-01-01',
        probabilityLow: 20,
        probabilityHigh: 40,
        certaintyLevel: 'WEAK',
        version: 1,
      }),
      makeHypothesis({
        id: 'hyp-t2',
        name: 'GPA',
        date: '2024-02-01',
        probabilityLow: 50,
        probabilityHigh: 70,
        certaintyLevel: 'MODERATE',
        version: 2,
      }),
    ];

    const gpaTimeline = {
      name: 'GPA',
      versions: hypotheses.map((h) => ({ ...h, evidenceLinks: [] as HypothesisEvidenceLink[] })),
      confidenceTrajectory: [
        {
          version: 1,
          date: '2024-01-01',
          probabilityLow: 20,
          probabilityHigh: 40,
          certaintyLevel: 'WEAK',
        },
        {
          version: 2,
          date: '2024-02-01',
          probabilityLow: 50,
          probabilityHigh: 70,
          certaintyLevel: 'MODERATE',
        },
      ],
      directionChanges: 0,
    };

    const hypothesisTimelines = new Map<string, typeof gpaTimeline>();
    hypothesisTimelines.set('GPA', gpaTimeline);

    const store = createMockStore({ hypotheses, hypothesisTimelines });
    const ctx = await buildPatientContext(store, PATIENT_ID);

    // Only unique names — GPA appears once
    expect(ctx.tierB.hypothesisTimelines).toHaveLength(1);
    const timeline = ctx.tierB.hypothesisTimelines[0];
    expect(timeline).toBeDefined();
    expect(timeline?.name).toBe('GPA');
    expect(timeline?.versionCount).toBe(2);
    expect(timeline?.currentConfidence).toBe('50-70%');
    expect(timeline?.directionChanges).toBe(0);
    // Midpoint went from 30 to 60 (+30) → rising
    expect(timeline?.trajectory).toBe('rising');
  });

  it('identifies research gaps', async () => {
    // Many treatments, few hypotheses, no findings, no consultations
    const treatments: TreatmentTrial[] = Array.from({ length: 6 }, (_, i) =>
      makeTreatment({ id: `tx-gap-${i}`, medication: `Drug ${i}`, efficacy: 'none' }),
    );

    const researchSummary = makeResearchSummary({
      findingCount: 0,
      queryCount: 0,
      hypothesisCount: 0,
      evidenceLinkCount: 0,
    });

    const store = createMockStore({ treatments, researchSummary });
    const ctx = await buildPatientContext(store, PATIENT_ID);

    const gaps = ctx.tierB.researchAudit.gapAreas;
    expect(gaps.some((g) => g.includes('No research findings'))).toBe(true);
    expect(gaps.some((g) => g.includes('Many treatments tried but few hypotheses'))).toBe(true);
    expect(gaps.some((g) => g.includes('No specialist consultations'))).toBe(true);
  });

  it('includes token estimates with positive values', async () => {
    const labs: LabResult[] = [
      makeLab({ id: 'lab-tok', testName: 'CRP', value: 5, unit: 'mg/L', date: '2024-01-01' }),
    ];

    const store = createMockStore({ labs });
    const ctx = await buildPatientContext(store, PATIENT_ID);

    expect(ctx.tokenEstimate.tierA).toBeGreaterThan(0);
    expect(ctx.tokenEstimate.tierB).toBeGreaterThan(0);
    expect(typeof ctx.tokenEstimate.tierA).toBe('number');
    expect(typeof ctx.tokenEstimate.tierB).toBe('number');
  });

  it('includes generatedAt ISO timestamp', async () => {
    const store = createMockStore();
    const before = new Date().toISOString();
    const ctx = await buildPatientContext(store, PATIENT_ID);
    const after = new Date().toISOString();

    // Verify ISO 8601 format
    expect(ctx.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Verify it's within the test execution window
    expect(ctx.generatedAt >= before).toBe(true);
    expect(ctx.generatedAt <= after).toBe(true);
  });
});
