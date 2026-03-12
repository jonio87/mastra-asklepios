import {
  answerRoutingSchema,
  contradictingEvidenceSchema,
  diagnosticSynthesisSchema,
  divergencePointSchema,
  flowStateSchema,
  informativeTestSchema,
  rankedHypothesisSchema,
  specialistInputSchema,
} from './diagnostic-synthesis.js';

describe('rankedHypothesisSchema', () => {
  it('accepts a complete hypothesis with all fields', () => {
    const result = rankedHypothesisSchema.safeParse({
      name: 'Granulomatosis with Polyangiitis (GPA)',
      probability: { low: 35, high: 55 },
      advocateCase: 'PR3-ANCA positive with persistent leukopenia supports active GPA',
      skepticCase: 'No organ involvement documented — renal and pulmonary clear',
      arbiterVerdict:
        'Plausible but needs confirmatory testing; PR3-ANCA specific but no organ damage',
      evidenceTier: 'T1',
      certaintyLevel: 'MODERATE',
      supportingEvidence: [
        { claim: 'PR3-ANCA confirmed positive', source: 'Lab 2025-09-01', tier: 'T1' },
        { claim: 'Chronic leukopenia', source: 'Lab trend 2019-2025', tier: 'T1' },
      ],
      contradictingEvidence: [
        { claim: 'No renal involvement', source: 'Renal function panel', tier: 'T1' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects probability range outside 0-100', () => {
    const result = rankedHypothesisSchema.safeParse({
      name: 'Test',
      probability: { low: -5, high: 120 },
      advocateCase: 'test',
      skepticCase: 'test',
      arbiterVerdict: 'test',
      evidenceTier: 'T2',
      certaintyLevel: 'WEAK',
    });
    expect(result.success).toBe(false);
  });

  it('validates certainty level enum', () => {
    const result = rankedHypothesisSchema.safeParse({
      name: 'Test',
      probability: { low: 20, high: 40 },
      advocateCase: 'test',
      skepticCase: 'test',
      arbiterVerdict: 'test',
      evidenceTier: 'T1',
      certaintyLevel: 'invalid-level',
    });
    expect(result.success).toBe(false);
  });
});

describe('divergencePointSchema', () => {
  it('accepts a valid divergence point', () => {
    const result = divergencePointSchema.safeParse({
      topic: 'Role of PR3-ANCA in small vessel vasculitis',
      advocatePosition: 'PR3-ANCA indicates active GPA requiring treatment',
      skepticPosition: 'PR3-ANCA may be incidental given no organ damage',
      resolution: 'ANCA titer quantification + organ-specific imaging',
    });
    expect(result.success).toBe(true);
  });

  it('requires all four fields', () => {
    const result = divergencePointSchema.safeParse({
      topic: 'Test topic',
      advocatePosition: 'Position A',
    });
    expect(result.success).toBe(false);
  });
});

describe('informativeTestSchema', () => {
  it('accepts a complete test recommendation', () => {
    const result = informativeTestSchema.safeParse({
      test: 'High-resolution CT chest',
      targetHypothesis: 'GPA vs drug-induced vasculitis',
      expectedImpact: 'If positive: GPA rises to 70%. If negative: GPA drops to 30%.',
      urgency: 'IMMEDIATE',
      alreadyDone: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts test with result when already done', () => {
    const result = informativeTestSchema.safeParse({
      test: 'PR3-ANCA quantitative',
      targetHypothesis: 'GPA confirmation',
      expectedImpact: 'High titer confirms active disease',
      urgency: 'SHORT_TERM',
      alreadyDone: true,
      result: 'Positive, titer 1:160',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.alreadyDone).toBe(true);
      expect(result.data.result).toBe('Positive, titer 1:160');
    }
  });

  it('validates urgency enum', () => {
    const result = informativeTestSchema.safeParse({
      test: 'Test',
      targetHypothesis: 'H1',
      expectedImpact: 'Impact',
      urgency: 'OPTIONAL',
    });
    expect(result.success).toBe(false);
  });
});

describe('diagnosticSynthesisSchema', () => {
  it('accepts a complete synthesis with all sections', () => {
    const result = diagnosticSynthesisSchema.safeParse({
      hypotheses: [
        {
          name: 'GPA',
          probability: { low: 35, high: 55 },
          advocateCase: 'Strong evidence from PR3-ANCA',
          skepticCase: 'Weak — no organ damage',
          arbiterVerdict: 'Plausible, needs confirmatory testing',
          evidenceTier: 'T1',
          certaintyLevel: 'MODERATE',
        },
      ],
      convergencePoints: ['All perspectives agree on autoimmune etiology'],
      divergencePoints: [
        {
          topic: 'Primary vs secondary vasculitis',
          advocatePosition: 'Primary GPA',
          skepticPosition: 'Secondary to underlying CTD',
          resolution: 'Tissue biopsy',
        },
      ],
      mostInformativeTests: [
        {
          test: 'CT chest',
          targetHypothesis: 'GPA',
          expectedImpact: 'Pulmonary nodules = GPA confirmed',
          urgency: 'IMMEDIATE',
        },
      ],
      unresolvedQuestions: ['Dual diagnosis possible?'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty synthesis (placeholder)', () => {
    const result = diagnosticSynthesisSchema.safeParse({
      hypotheses: [],
      convergencePoints: [],
      divergencePoints: [],
      mostInformativeTests: [],
      unresolvedQuestions: [],
    });
    expect(result.success).toBe(true);
  });
});

describe('specialistInputSchema', () => {
  it('accepts complete specialist input', () => {
    const result = specialistInputSchema.safeParse({
      specialistName: 'Dr. Kowalski',
      specialty: 'Rheumatology',
      institution: 'Uniwersytecki Szpital Kliniczny',
      date: '2025-12-15',
      physicalExamination: ['Joint swelling bilateral MCPs', 'Dry eyes noted'],
      clinicalImpression: 'Consistent with Sjögren syndrome overlap',
      hypothesisAgreement: [
        {
          hypothesisName: 'GPA',
          verdict: 'uncertain',
          reasoning: 'PR3-ANCA positive but no organ damage',
        },
        {
          hypothesisName: 'Sjögren syndrome',
          verdict: 'agree',
          reasoning: 'Ro-60 positive, dry eyes, polyneuropathy',
        },
      ],
      recommendedTests: ['Lip biopsy', 'Schirmer test'],
      modelBreaking: false,
      patientId: 'tomasz-szychlinski',
    });
    expect(result.success).toBe(true);
  });

  it('accepts model-breaking specialist input', () => {
    const result = specialistInputSchema.safeParse({
      specialistName: 'Dr. Smith',
      specialty: 'Neurology',
      date: '2025-12-20',
      physicalExamination: ['New finding: papilledema bilateral'],
      clinicalImpression:
        'Raised intracranial pressure contradicts intracranial hypotension hypothesis',
      hypothesisAgreement: [
        {
          hypothesisName: 'Intracranial hypotension',
          verdict: 'disagree',
          reasoning: 'Papilledema indicates raised ICP, not low',
        },
      ],
      modelBreaking: true,
      modelBreakingDetail:
        'Papilledema finding contradicts intracranial hypotension hypothesis at 80% confidence',
      patientId: 'tomasz-szychlinski',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modelBreaking).toBe(true);
    }
  });

  it('requires mandatory fields', () => {
    const result = specialistInputSchema.safeParse({
      specialistName: 'Dr. Test',
    });
    expect(result.success).toBe(false);
  });
});

describe('flowStateSchema', () => {
  it('accepts a fresh flow state (stage 0)', () => {
    const result = flowStateSchema.safeParse({
      currentStage: 0,
      stageGates: {
        recordsIngested: false,
        brainRecalled: false,
        interviewComplete: false,
        researchComplete: false,
        hypothesesGenerated: false,
        followUpQuestionsAnswered: false,
        adversarialComplete: false,
        specialistIntegrated: false,
        deliverablesGenerated: false,
      },
      feedbackLoops: {
        stage6ToStage4: 0,
        stage6ToStage5: 0,
        stage8ToStage7: 0,
      },
      coldStart: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a mid-flow state with feedback loops', () => {
    const result = flowStateSchema.safeParse({
      currentStage: 6,
      stageGates: {
        recordsIngested: true,
        brainRecalled: true,
        interviewComplete: true,
        researchComplete: true,
        hypothesesGenerated: true,
        followUpQuestionsAnswered: false,
        adversarialComplete: false,
        specialistIntegrated: false,
        deliverablesGenerated: false,
      },
      feedbackLoops: {
        stage6ToStage4: 1,
        stage6ToStage5: 2,
        stage8ToStage7: 0,
      },
      coldStart: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currentStage).toBe(6);
      expect(result.data.feedbackLoops.stage6ToStage5).toBe(2);
    }
  });

  it('rejects stage number outside 0-9', () => {
    const result = flowStateSchema.safeParse({
      currentStage: 10,
      stageGates: {
        recordsIngested: false,
        brainRecalled: false,
        interviewComplete: false,
        researchComplete: false,
        hypothesesGenerated: false,
        followUpQuestionsAnswered: false,
        adversarialComplete: false,
        specialistIntegrated: false,
        deliverablesGenerated: false,
      },
      feedbackLoops: {
        stage6ToStage4: 0,
        stage6ToStage5: 0,
        stage8ToStage7: 0,
      },
      coldStart: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects cold start as true when set', () => {
    const result = flowStateSchema.safeParse({
      currentStage: 1,
      stageGates: {
        recordsIngested: false,
        brainRecalled: false,
        interviewComplete: false,
        researchComplete: false,
        hypothesesGenerated: false,
        followUpQuestionsAnswered: false,
        adversarialComplete: false,
        specialistIntegrated: false,
        deliverablesGenerated: false,
      },
      feedbackLoops: {
        stage6ToStage4: 0,
        stage6ToStage5: 0,
        stage8ToStage7: 0,
      },
      coldStart: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.coldStart).toBe(true);
    }
  });
});

describe('contradictingEvidenceSchema', () => {
  it('accepts valid contradicting evidence', () => {
    const result = contradictingEvidenceSchema.safeParse({
      source: 'Lab result 2025-09-01',
      date: '2025-09-01',
      detail: 'Anti-Ro-60 negative in September contradicts August positive result',
      tier: 'T1',
    });
    expect(result.success).toBe(true);
  });

  it('validates tier enum', () => {
    const result = contradictingEvidenceSchema.safeParse({
      source: 'test',
      date: '2025-01-01',
      detail: 'test',
      tier: 'T4',
    });
    expect(result.success).toBe(false);
  });
});

describe('answerRoutingSchema', () => {
  it('accepts a detail-level routing', () => {
    const result = answerRoutingSchema.safeParse({
      answerType: 'detail',
      targetStage: 7,
      impactDescription: 'Confirms dry eye symptoms, supports Sjögren hypothesis',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a model-breaking routing with affected hypothesis', () => {
    const result = answerRoutingSchema.safeParse({
      answerType: 'model-breaking',
      targetStage: 4,
      affectedHypothesis: 'Intracranial hypotension',
      impactDescription: 'Pain started before septoplasty, eliminates surgical cause',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid target stage', () => {
    const result = answerRoutingSchema.safeParse({
      answerType: 'detail',
      targetStage: 1,
      impactDescription: 'test',
    });
    expect(result.success).toBe(false);
  });
});
