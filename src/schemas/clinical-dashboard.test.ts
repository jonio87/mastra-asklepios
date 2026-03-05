import { clinicalDashboardSchema } from './clinical-dashboard.js';

describe('clinicalDashboardSchema', () => {
  it('accepts a minimal empty dashboard', () => {
    const result = clinicalDashboardSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a fully populated dashboard', () => {
    const result = clinicalDashboardSchema.safeParse({
      demographics: { age: '34M', sex: 'male', keyContext: '16-year diagnostic odyssey' },
      activeConcerns: [
        {
          concern: 'Progressive upper limb weakness since 2020',
          priority: 'critical',
          since: '2020',
        },
        { concern: 'Undiagnosed chronic facial pain', priority: 'high' },
      ],
      currentHypotheses: [
        {
          diagnosis: 'Trigeminocervical convergence',
          confidence: 62,
          keyEvidence: 'Pain migrated C2→V1/V2 after GON block',
          diagnosticTestOfRecord: 'EMG/NCS',
          dtorStatus: 'not-done',
        },
      ],
      plannedActions: [
        {
          action: 'EMG/NCS — most important missing test',
          urgency: 'immediate',
          rationale: 'Distinguish UMN vs LMN',
        },
      ],
      criticalFindings: [
        'Anti-Ro-60 DISCREPANT: positive microblot vs negative immunoblot (5 days apart)',
        'WBC declining: 3.5→2.59 over 6 years — nadir 2025',
      ],
      patientGoals: ['Wants diagnosis before treatment', 'Concerned about weakness progression'],
      recentPatientReport: "Pain 7/10, can't hold phone >2min, brain fog severe",
      lastUpdated: '2026-03-05T12:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('validates hypothesis confidence range (0-100)', () => {
    const tooLow = clinicalDashboardSchema.safeParse({
      currentHypotheses: [{ diagnosis: 'TCC', confidence: -1, keyEvidence: 'test' }],
    });
    expect(tooLow.success).toBe(false);

    const tooHigh = clinicalDashboardSchema.safeParse({
      currentHypotheses: [{ diagnosis: 'TCC', confidence: 101, keyEvidence: 'test' }],
    });
    expect(tooHigh.success).toBe(false);

    const valid = clinicalDashboardSchema.safeParse({
      currentHypotheses: [{ diagnosis: 'TCC', confidence: 55, keyEvidence: 'evidence' }],
    });
    expect(valid.success).toBe(true);
  });

  it('validates priority enum for active concerns', () => {
    const invalid = clinicalDashboardSchema.safeParse({
      activeConcerns: [{ concern: 'test', priority: 'extreme' }],
    });
    expect(invalid.success).toBe(false);

    for (const priority of ['critical', 'high', 'medium', 'low'] as const) {
      const valid = clinicalDashboardSchema.safeParse({
        activeConcerns: [{ concern: 'test', priority }],
      });
      expect(valid.success).toBe(true);
    }
  });

  it('validates urgency enum for planned actions', () => {
    const invalid = clinicalDashboardSchema.safeParse({
      plannedActions: [{ action: 'test', urgency: 'asap' }],
    });
    expect(invalid.success).toBe(false);

    for (const urgency of ['immediate', 'soon', 'routine', 'when-feasible'] as const) {
      const valid = clinicalDashboardSchema.safeParse({
        plannedActions: [{ action: 'test', urgency }],
      });
      expect(valid.success).toBe(true);
    }
  });

  it('validates dtorStatus enum for hypotheses', () => {
    const invalid = clinicalDashboardSchema.safeParse({
      currentHypotheses: [
        {
          diagnosis: 'TCC',
          confidence: 50,
          keyEvidence: 'test',
          dtorStatus: 'in-progress',
        },
      ],
    });
    expect(invalid.success).toBe(false);

    for (const status of ['not-done', 'pending', 'done'] as const) {
      const valid = clinicalDashboardSchema.safeParse({
        currentHypotheses: [
          {
            diagnosis: 'TCC',
            confidence: 50,
            keyEvidence: 'test',
            dtorStatus: status,
          },
        ],
      });
      expect(valid.success).toBe(true);
    }
  });

  it('requires concern and priority for active concerns', () => {
    const missingPriority = clinicalDashboardSchema.safeParse({
      activeConcerns: [{ concern: 'weakness' }],
    });
    expect(missingPriority.success).toBe(false);

    const missingConcern = clinicalDashboardSchema.safeParse({
      activeConcerns: [{ priority: 'high' }],
    });
    expect(missingConcern.success).toBe(false);
  });

  it('requires diagnosis, confidence, and keyEvidence for hypotheses', () => {
    const missingEvidence = clinicalDashboardSchema.safeParse({
      currentHypotheses: [{ diagnosis: 'TCC', confidence: 50 }],
    });
    expect(missingEvidence.success).toBe(false);

    const missingConfidence = clinicalDashboardSchema.safeParse({
      currentHypotheses: [{ diagnosis: 'TCC', keyEvidence: 'test' }],
    });
    expect(missingConfidence.success).toBe(false);
  });

  it('accepts partial demographics', () => {
    const result = clinicalDashboardSchema.safeParse({
      demographics: { age: '34M' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty arrays for optional array fields', () => {
    const result = clinicalDashboardSchema.safeParse({
      activeConcerns: [],
      currentHypotheses: [],
      plannedActions: [],
      criticalFindings: [],
      patientGoals: [],
    });
    expect(result.success).toBe(true);
  });
});
