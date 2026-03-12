import { describe, expect, it } from '@jest/globals';
import type { PatientContext } from '../utils/patient-context.js';
import {
  estimateResearchDepth,
  generateContradictionQuestions,
  generateDataCompletenessQuestions,
  generateHypothesisGapQuestions,
  generateLabDrivenQuestions,
  generateResearchGapQuestions,
  generateResearchQuestions,
  generateTreatmentDrivenQuestions,
  groupIntoPhases,
  parseConfidenceMidpoint,
  researchPlanTool,
} from './research-plan.js';

// ─── Helper: full PatientContext with sensible defaults ───────────────────────

type Hypothesis = PatientContext['tierA']['currentHypotheses'][number];

function makeContext(overrides?: {
  tierA?: Partial<PatientContext['tierA']>;
  tierB?: Partial<PatientContext['tierB']>;
}): PatientContext {
  const baseTierA: PatientContext['tierA'] = {
    patientId: 'patient-001',
    demographics: { age: '35', sex: 'Female', keyContext: 'Chronic fatigue' },
    activeConcerns: [
      { concern: 'chronic fatigue', priority: 'high', since: '2025-01-01' },
      { concern: 'joint pain', priority: 'medium', since: '2025-02-01' },
      { concern: 'skin rash', priority: 'low', since: '2025-03-01' },
    ],
    currentHypotheses: [],
    criticalFindings: [],
    dataCompleteness: {
      labCount: 5,
      consultationCount: 3,
      treatmentCount: 2,
      contradictionCount: 0,
      reportCount: 1,
      hasResearch: true,
    },
    researchState: {
      findingCount: 10,
      hypothesisCount: 2,
      latestResearchDate: '2025-06-01',
      topSources: [{ source: 'PubMed', count: 8 }],
    },
    treatmentLandscape: {
      totalTrials: 2,
      effectiveCount: 1,
      ineffectiveCount: 1,
      activeCount: 0,
      drugClassesTried: ['NSAIDs'],
    },
  };

  const baseTierB: PatientContext['tierB'] = {
    labTrends: [],
    temporalMap: [],
    hypothesisTimelines: [],
    unresolvedContradictions: [],
    researchAudit: {
      totalQueries: 5,
      totalFindings: 10,
      evidenceLinkCount: 3,
      gapAreas: [],
      recentFindings: [
        {
          title: 'Fatigue in autoimmune disease',
          source: 'PubMed',
          relevance: 0.9,
          date: '2025-05-01',
        },
      ],
    },
    recentConsultations: [
      {
        specialty: 'Rheumatology',
        date: '2025-04-01',
        conclusions: 'Possible autoimmune',
        conclusionsStatus: 'preliminary',
      },
    ],
  };

  return {
    tierA: { ...baseTierA, ...overrides?.tierA },
    tierB: { ...baseTierB, ...overrides?.tierB },
    generatedAt: '2025-06-15T12:00:00.000Z',
    tokenEstimate: { tierA: 500, tierB: 2000 },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('researchPlanTool', () => {
  // 1. Tool configuration
  it('has correct tool id, inputSchema, outputSchema, and execute', () => {
    expect(researchPlanTool.id).toBe('research-plan');
    expect(researchPlanTool.inputSchema).toBeDefined();
    expect(researchPlanTool.outputSchema).toBeDefined();
    expect(researchPlanTool.execute).toBeDefined();
  });
});

describe('parseConfidenceMidpoint', () => {
  it('parses "10-30%" to 20', () => {
    expect(parseConfidenceMidpoint('10-30%')).toBe(20);
  });

  it('parses "50-70%" to 60', () => {
    expect(parseConfidenceMidpoint('50-70%')).toBe(60);
  });

  it('returns 50 for unparseable range', () => {
    expect(parseConfidenceMidpoint('unknown')).toBe(50);
  });
});

describe('generateHypothesisGapQuestions', () => {
  const activeConcerns = [
    { concern: 'chronic fatigue', priority: 'high' as const, since: '2025-01-01' },
    { concern: 'joint pain', priority: 'medium' as const, since: '2025-02-01' },
  ];

  it('generates gap question for hypothesis with confidence midpoint < 40', () => {
    const hypotheses: Hypothesis[] = [
      {
        name: 'Lupus',
        confidenceRange: '10-30%',
        certaintyLevel: 'EMERGING',
        keyEvidence: 'ANA positive',
      },
    ];

    const questions = generateHypothesisGapQuestions(hypotheses, activeConcerns);

    const gapQ = questions.find(
      (q) =>
        q.question.includes('What evidence supports or contradicts') &&
        q.question.includes('Lupus'),
    );
    expect(gapQ).toBeDefined();
    expect(gapQ?.targetHypothesis).toBe('Lupus');
    expect(gapQ?.expectedImpact).toBe('high');
    expect(gapQ?.gapAddressed).toContain('Low confidence');
    expect(gapQ?.gapAddressed).toContain('10-30%');
  });

  it('does NOT generate gap question for hypothesis with confidence midpoint >= 40', () => {
    const hypotheses: Hypothesis[] = [
      {
        name: 'Lupus',
        confidenceRange: '50-70%',
        certaintyLevel: 'ESTABLISHED',
        keyEvidence: 'ANA positive',
      },
    ];

    const questions = generateHypothesisGapQuestions(hypotheses, activeConcerns);

    const gapQ = questions.find(
      (q) =>
        q.question.includes('What evidence supports or contradicts') &&
        q.question.includes('Lupus'),
    );
    expect(gapQ).toBeUndefined();
  });

  it('generates case-report question for SPECULATIVE certaintyLevel', () => {
    const hypotheses: Hypothesis[] = [
      {
        name: 'Erdheim-Chester',
        confidenceRange: '50-70%',
        certaintyLevel: 'SPECULATIVE',
        keyEvidence: 'Bone pain',
      },
    ];

    const questions = generateHypothesisGapQuestions(hypotheses, activeConcerns);

    const specQ = questions.find(
      (q) => q.question.includes('case report') && q.question.includes('Erdheim-Chester'),
    );
    expect(specQ).toBeDefined();
    expect(specQ?.expectedImpact).toBe('medium');
    expect(specQ?.searchTerms).toContain('case report');
    expect(specQ?.gapAddressed).toContain('Speculative');
  });

  it('includes symptom cluster from activeConcerns in speculative question', () => {
    const hypotheses: Hypothesis[] = [
      {
        name: 'Erdheim-Chester',
        confidenceRange: '50-70%',
        certaintyLevel: 'SPECULATIVE',
        keyEvidence: 'Bone pain',
      },
    ];

    const questions = generateHypothesisGapQuestions(hypotheses, activeConcerns);

    const specQ = questions.find(
      (q) => q.question.includes('case report') && q.question.includes('Erdheim-Chester'),
    );
    expect(specQ).toBeDefined();
    expect(specQ?.question).toContain('chronic fatigue');
  });
});

describe('generateDataCompletenessQuestions', () => {
  it('generates broad literature review when hasResearch is false', () => {
    const tierA = makeContext({
      tierA: {
        dataCompleteness: {
          labCount: 0,
          consultationCount: 0,
          treatmentCount: 0,
          contradictionCount: 0,
          reportCount: 0,
          hasResearch: false,
        },
      },
    }).tierA;

    const questions = generateDataCompletenessQuestions(tierA, 'Fibromyalgia');

    const litQ = questions.find((q) => q.question.includes('Broad literature review'));
    expect(litQ).toBeDefined();
    expect(litQ?.expectedImpact).toBe('high');
    expect(litQ?.gapAddressed).toContain('No research findings recorded');
    expect(litQ?.targetHypothesis).toBe('Fibromyalgia');
  });

  it('generates alternative therapy question when ineffectiveCount > 2 and effectiveCount === 0', () => {
    const tierA = makeContext({
      tierA: {
        treatmentLandscape: {
          totalTrials: 5,
          effectiveCount: 0,
          ineffectiveCount: 3,
          activeCount: 0,
          drugClassesTried: ['NSAIDs', 'Opioids'],
        },
      },
    }).tierA;

    const questions = generateDataCompletenessQuestions(tierA, 'Chronic Pain');

    const altQ = questions.find((q) => q.question.includes('alternative therapeutic pathways'));
    expect(altQ).toBeDefined();
    expect(altQ?.expectedImpact).toBe('high');
    expect(altQ?.question).toContain('NSAIDs');
    expect(altQ?.gapAddressed).toContain('3 treatment failures');
  });

  it('does NOT generate therapy question when effectiveCount > 0', () => {
    const tierA = makeContext({
      tierA: {
        treatmentLandscape: {
          totalTrials: 5,
          effectiveCount: 1,
          ineffectiveCount: 3,
          activeCount: 1,
          drugClassesTried: ['NSAIDs'],
        },
      },
    }).tierA;

    const questions = generateDataCompletenessQuestions(tierA, 'Test');

    const altQ = questions.find((q) => q.question.includes('alternative therapeutic pathways'));
    expect(altQ).toBeUndefined();
  });
});

describe('generateLabDrivenQuestions', () => {
  it('generates question for rising lab trend', () => {
    const labTrends = [
      {
        testName: 'ALT',
        direction: 'rising' as const,
        rateOfChange: 5.2,
        clinicalNote: 'Trending upward over 3 months',
        latestValue: '120 U/L',
        latestDate: '2025-06-01',
        dataPoints: 4,
      },
    ];

    const questions = generateLabDrivenQuestions(labTrends, 'Liver Disease');

    const labQ = questions.find((q) => q.question.includes('progressive ALT elevation'));
    expect(labQ).toBeDefined();
    expect(labQ?.expectedImpact).toBe('high');
    expect(labQ?.question).toContain('120 U/L');
    expect(labQ?.gapAddressed).toContain('Rising ALT trend');
    expect(labQ?.gapAddressed).toContain('4 data points');
  });

  it('generates urgent question when clinicalNote includes critical', () => {
    const labTrends = [
      {
        testName: 'Creatinine',
        direction: 'stable' as const,
        rateOfChange: undefined,
        clinicalNote: 'CRITICAL value - immediate attention required',
        latestValue: '5.2 mg/dL',
        latestDate: '2025-06-10',
        dataPoints: 2,
      },
    ];

    const questions = generateLabDrivenQuestions(labTrends, 'Acute Kidney Injury');

    const critQ = questions.find(
      (q) => q.question.toLowerCase().includes('urgent') && q.question.includes('Creatinine'),
    );
    expect(critQ).toBeDefined();
    expect(critQ?.expectedImpact).toBe('high');
    expect(critQ?.question).toContain('5.2 mg/dL');
    expect(critQ?.gapAddressed).toContain('Critical Creatinine value');
    expect(critQ?.searchTerms).toContain('critical value');
  });

  it('skips trends with rate of change < 15%', () => {
    const labTrends = [
      {
        testName: 'Chloride',
        direction: 'rising' as const,
        rateOfChange: 0.05,
        clinicalNote: 'Normalizing',
        latestValue: '101',
        latestDate: '2025-06-01',
        dataPoints: 3,
      },
    ];

    const questions = generateLabDrivenQuestions(labTrends, 'Test');
    expect(questions).toHaveLength(0);
  });

  it('skips trends with "within normal" in clinicalNote', () => {
    const labTrends = [
      {
        testName: 'IgG',
        direction: 'rising' as const,
        rateOfChange: 0.5,
        clinicalNote: 'Within normal range fluctuation',
        latestValue: '1160 mg/dL',
        latestDate: '2025-06-01',
        dataPoints: 3,
      },
    ];

    const questions = generateLabDrivenQuestions(labTrends, 'Test');
    expect(questions).toHaveLength(0);
  });
});

describe('generateContradictionQuestions', () => {
  it('generates discrepancy resolution question for unresolved contradictions', () => {
    const contradictions = [
      {
        finding1: 'Anti-Ro positive',
        finding2: 'Normal salivary gland biopsy',
        diagnosticImpact: 'Challenges Sjögren diagnosis',
        resolutionPlan: 'Repeat biopsy with different site',
      },
    ];

    const questions = generateContradictionQuestions(contradictions, 'Sjögren Syndrome');

    const contradQ = questions.find(
      (q) =>
        q.question.toLowerCase().includes('discrepancy') ||
        q.question.toLowerCase().includes('resolve'),
    );
    expect(contradQ).toBeDefined();
    expect(contradQ?.question).toContain('Anti-Ro positive');
    expect(contradQ?.question).toContain('Normal salivary gland biopsy');
    expect(contradQ?.expectedImpact).toBe('high');
    expect(contradQ?.gapAddressed).toBe('Challenges Sjögren diagnosis');
  });
});

describe('generateTreatmentDrivenQuestions', () => {
  it('generates per-drug-class alternative questions when ineffectiveCount > 1', () => {
    const treatmentLandscape = {
      totalTrials: 4,
      effectiveCount: 0,
      ineffectiveCount: 3,
      activeCount: 1,
      drugClassesTried: ['Gabapentinoids', 'TCAs'],
    };

    const questions = generateTreatmentDrivenQuestions(treatmentLandscape, 'Neuropathic Pain');

    const gabaQ = questions.find((q) =>
      q.question.includes('Alternative mechanisms beyond Gabapentinoids'),
    );
    const tcaQ = questions.find((q) => q.question.includes('Alternative mechanisms beyond TCAs'));
    expect(gabaQ).toBeDefined();
    expect(tcaQ).toBeDefined();
    expect(gabaQ?.expectedImpact).toBe('medium');
    expect(gabaQ?.searchTerms).toContain('pharmacogenomics');
  });

  it('generates novel therapy question when effectiveCount === 0 and totalTrials > 0', () => {
    const treatmentLandscape = {
      totalTrials: 3,
      effectiveCount: 0,
      ineffectiveCount: 1,
      activeCount: 0,
      drugClassesTried: [],
    };

    const questions = generateTreatmentDrivenQuestions(treatmentLandscape, 'Refractory Pain');

    const novelQ = questions.find((q) => q.question.includes('Novel or experimental'));
    expect(novelQ).toBeDefined();
    expect(novelQ?.expectedImpact).toBe('medium');
    expect(novelQ?.gapAddressed).toContain('3 trials');
  });
});

describe('generateResearchGapQuestions', () => {
  it('generates questions from gapAreas', () => {
    const gapAreas = ['genetic predisposition markers', 'long-term prognosis data'];

    const questions = generateResearchGapQuestions(gapAreas, 'Autoimmune');

    const gapQ1 = questions.find((q) => q.question.includes('genetic predisposition markers'));
    const gapQ2 = questions.find((q) => q.question.includes('long-term prognosis data'));
    expect(gapQ1).toBeDefined();
    expect(gapQ2).toBeDefined();
    expect(gapQ1?.expectedImpact).toBe('medium');
    expect(gapQ1?.gapAddressed).toBe('genetic predisposition markers');
    expect(gapQ2?.gapAddressed).toBe('long-term prognosis data');
  });
});

describe('generateResearchQuestions (integrated)', () => {
  it('returns 0 questions when no hypotheses, no trends, no contradictions, no gaps', () => {
    const ctx = makeContext({
      tierA: {
        treatmentLandscape: {
          totalTrials: 0,
          effectiveCount: 0,
          ineffectiveCount: 0,
          activeCount: 0,
          drugClassesTried: [],
        },
      },
    });

    const questions = generateResearchQuestions(ctx, undefined, 15);
    expect(questions).toHaveLength(0);
  });

  it('respects maxQuestions limit', () => {
    const ctx = makeContext({
      tierA: {
        currentHypotheses: [
          {
            name: 'Hyp A',
            confidenceRange: '5-15%',
            certaintyLevel: 'SPECULATIVE',
            keyEvidence: 'A',
          },
          {
            name: 'Hyp B',
            confidenceRange: '10-20%',
            certaintyLevel: 'SPECULATIVE',
            keyEvidence: 'B',
          },
          {
            name: 'Hyp C',
            confidenceRange: '15-25%',
            certaintyLevel: 'SPECULATIVE',
            keyEvidence: 'C',
          },
        ],
        dataCompleteness: {
          labCount: 0,
          consultationCount: 0,
          treatmentCount: 0,
          contradictionCount: 0,
          reportCount: 0,
          hasResearch: false,
        },
        treatmentLandscape: {
          totalTrials: 5,
          effectiveCount: 0,
          ineffectiveCount: 4,
          activeCount: 0,
          drugClassesTried: ['ClassA', 'ClassB', 'ClassC'],
        },
      },
      tierB: {
        labTrends: [
          {
            testName: 'WBC',
            direction: 'rising',
            rateOfChange: 2.0,
            clinicalNote: 'critical low',
            latestValue: '2.0',
            latestDate: '2025-06-01',
            dataPoints: 3,
          },
        ],
        temporalMap: [],
        hypothesisTimelines: [],
        unresolvedContradictions: [
          {
            finding1: 'F1',
            finding2: 'F2',
            diagnosticImpact: 'Impact 1',
            resolutionPlan: undefined,
          },
        ],
        researchAudit: {
          totalQueries: 5,
          totalFindings: 10,
          evidenceLinkCount: 3,
          gapAreas: ['gap1', 'gap2'],
          recentFindings: [],
        },
        recentConsultations: [],
      },
    });

    const questions = generateResearchQuestions(ctx, undefined, 3);
    expect(questions.length).toBeLessThanOrEqual(3);
  });

  it('does not produce duplicate questions', () => {
    const ctx = makeContext({
      tierA: {
        currentHypotheses: [
          {
            name: 'Rare Disease X',
            confidenceRange: '10-20%',
            certaintyLevel: 'SPECULATIVE',
            keyEvidence: 'Unusual labs',
          },
        ],
        treatmentLandscape: {
          totalTrials: 0,
          effectiveCount: 0,
          ineffectiveCount: 0,
          activeCount: 0,
          drugClassesTried: [],
        },
      },
    });

    const questions = generateResearchQuestions(ctx, undefined, 15);
    const questionTexts = questions.map((q) => q.question);
    const uniqueTexts = new Set(questionTexts);
    expect(questionTexts.length).toBe(uniqueTexts.size);
  });

  it('only generates questions for specified focusHypotheses', () => {
    const ctx = makeContext({
      tierA: {
        currentHypotheses: [
          {
            name: 'Lupus',
            confidenceRange: '10-30%',
            certaintyLevel: 'EMERGING',
            keyEvidence: 'ANA',
          },
          {
            name: 'Fibromyalgia',
            confidenceRange: '15-25%',
            certaintyLevel: 'EMERGING',
            keyEvidence: 'Pain',
          },
          {
            name: 'Sjögren',
            confidenceRange: '20-35%',
            certaintyLevel: 'SPECULATIVE',
            keyEvidence: 'Dry eyes',
          },
        ],
        treatmentLandscape: {
          totalTrials: 0,
          effectiveCount: 0,
          ineffectiveCount: 0,
          activeCount: 0,
          drugClassesTried: [],
        },
      },
    });

    const questions = generateResearchQuestions(ctx, ['Lupus'], 15);

    // Should NOT have questions mentioning Fibromyalgia or Sjögren
    const fibQ = questions.find((q) => q.question.includes('Fibromyalgia'));
    const sjoQ = questions.find((q) => q.question.includes('Sjögren'));
    expect(fibQ).toBeUndefined();
    expect(sjoQ).toBeUndefined();
  });
});

describe('groupIntoPhases', () => {
  it('groups high-impact into immediate and medium into short-term', () => {
    const hypotheses: Hypothesis[] = [
      {
        name: 'Lupus',
        confidenceRange: '10-30%',
        certaintyLevel: 'SPECULATIVE',
        keyEvidence: 'ANA',
      },
    ];

    const activeConcerns = [
      { concern: 'chronic fatigue', priority: 'high' as const, since: '2025-01-01' },
    ];

    const gapQuestions = generateHypothesisGapQuestions(hypotheses, activeConcerns);
    const gapAreaQuestions = generateResearchGapQuestions(['biomarker validation'], 'Lupus');
    const allQ = [...gapQuestions, ...gapAreaQuestions];

    const phases = groupIntoPhases(allQ);

    // High-impact → immediate
    const immediatePhase = phases.find((p) => p.phase === 'immediate');
    expect(immediatePhase).toBeDefined();
    for (const q of immediatePhase!.questions) {
      expect(q.expectedImpact).toBe('high');
    }

    // Medium-impact → short-term
    const shortTermPhase = phases.find((p) => p.phase === 'short-term');
    expect(shortTermPhase).toBeDefined();
    for (const q of shortTermPhase!.questions) {
      expect(q.expectedImpact).toBe('medium');
    }
  });
});

describe('estimateResearchDepth', () => {
  it('returns deep when hasResearch is false', () => {
    const ctx = makeContext({
      tierA: {
        dataCompleteness: {
          labCount: 0,
          consultationCount: 0,
          treatmentCount: 0,
          contradictionCount: 0,
          reportCount: 0,
          hasResearch: false,
        },
      },
    });

    expect(estimateResearchDepth(ctx, 0)).toBe('deep');
  });

  it('returns deep when totalQuestions > 12', () => {
    const ctx = makeContext();
    expect(estimateResearchDepth(ctx, 15)).toBe('deep');
  });

  it('returns deep when contradictions > 2', () => {
    const ctx = makeContext({
      tierB: {
        unresolvedContradictions: [
          { finding1: 'A', finding2: 'B', diagnosticImpact: 'X', resolutionPlan: undefined },
          { finding1: 'C', finding2: 'D', diagnosticImpact: 'Y', resolutionPlan: undefined },
          { finding1: 'E', finding2: 'F', diagnosticImpact: 'Z', resolutionPlan: undefined },
        ],
        labTrends: [],
        temporalMap: [],
        hypothesisTimelines: [],
        researchAudit: {
          totalQueries: 5,
          totalFindings: 10,
          evidenceLinkCount: 3,
          gapAreas: [],
          recentFindings: [],
        },
        recentConsultations: [],
      },
    });

    expect(estimateResearchDepth(ctx, 3)).toBe('deep');
  });

  it('returns moderate when gaps > 2', () => {
    const ctx = makeContext({
      tierB: {
        labTrends: [],
        temporalMap: [],
        hypothesisTimelines: [],
        unresolvedContradictions: [],
        researchAudit: {
          totalQueries: 5,
          totalFindings: 10,
          evidenceLinkCount: 3,
          gapAreas: ['g1', 'g2', 'g3'],
          recentFindings: [],
        },
        recentConsultations: [],
      },
    });

    expect(estimateResearchDepth(ctx, 3)).toBe('moderate');
  });

  it('returns shallow when data is complete and few questions generated', () => {
    const ctx = makeContext();
    expect(estimateResearchDepth(ctx, 2)).toBe('shallow');
  });
});
