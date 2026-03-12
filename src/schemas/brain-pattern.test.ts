import {
  brainPatternCategoryEnum,
  brainPatternInputSchema,
  brainPatternQuerySchema,
  brainPatternSchema,
  caseResolutionSchema,
} from './brain-pattern.js';

// ─── brainPatternSchema ──────────────────────────────────────────────────

describe('brainPatternSchema', () => {
  const validPattern = {
    id: 'bp-001',
    pattern: 'arachnodactyly + lens subluxation → Marfan not EDS',
    category: 'diagnostic-shortcut' as const,
    phenotypeCluster: ['arachnodactyly', 'lens subluxation'],
    supportingCases: 5,
    confidence: 0.85,
    relatedDiagnoses: ['Q87.4', 'Marfan syndrome'],
    relatedGenes: ['FBN1'],
    sourceCaseLabels: ['case-001', 'case-002'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
  };

  it('accepts a valid full pattern', () => {
    const result = brainPatternSchema.safeParse(validPattern);
    expect(result.success).toBe(true);
  });

  it('accepts a pattern without optional fields', () => {
    const { relatedDiagnoses, relatedGenes, ...minimal } = validPattern;
    const result = brainPatternSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const { id, pattern, ...rest } = validPattern;
    const result = brainPatternSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing category', () => {
    const { category, ...rest } = validPattern;
    const result = brainPatternSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid category', () => {
    const result = brainPatternSchema.safeParse({
      ...validPattern,
      category: 'invalid-category',
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence > 1', () => {
    const result = brainPatternSchema.safeParse({
      ...validPattern,
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence < 0', () => {
    const result = brainPatternSchema.safeParse({
      ...validPattern,
      confidence: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative supportingCases', () => {
    const result = brainPatternSchema.safeParse({
      ...validPattern,
      supportingCases: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer supportingCases', () => {
    const result = brainPatternSchema.safeParse({
      ...validPattern,
      supportingCases: 2.5,
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid categories', () => {
    const categories = [
      'diagnostic-shortcut',
      'common-misdiagnosis',
      'key-differentiator',
      'research-tip',
      'temporal-pattern',
      'phenotype-genotype',
    ] as const;

    for (const category of categories) {
      const result = brainPatternSchema.safeParse({ ...validPattern, category });
      expect(result.success).toBe(true);
    }
  });
});

// ─── brainPatternCategoryEnum ────────────────────────────────────────────

describe('brainPatternCategoryEnum', () => {
  it('accepts all 6 valid categories', () => {
    const categories = [
      'diagnostic-shortcut',
      'common-misdiagnosis',
      'key-differentiator',
      'research-tip',
      'temporal-pattern',
      'phenotype-genotype',
    ];
    for (const cat of categories) {
      expect(brainPatternCategoryEnum.safeParse(cat).success).toBe(true);
    }
  });

  it('rejects invalid category strings', () => {
    expect(brainPatternCategoryEnum.safeParse('unknown').success).toBe(false);
    expect(brainPatternCategoryEnum.safeParse('').success).toBe(false);
  });
});

// ─── brainPatternInputSchema ─────────────────────────────────────────────

describe('brainPatternInputSchema', () => {
  const validInput = {
    pattern: 'Beighton ≥7 + skin hyperextensibility → hEDS likely',
    category: 'diagnostic-shortcut' as const,
    phenotypeCluster: ['joint hypermobility', 'skin hyperextensibility'],
    supportingCases: 3,
    confidence: 0.75,
    sourceCaseLabels: ['case-010'],
  };

  it('accepts a valid input', () => {
    const result = brainPatternInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('applies default supportingCases of 1 when omitted', () => {
    const { supportingCases, ...rest } = validInput;
    const result = brainPatternInputSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.supportingCases).toBe(1);
    }
  });

  it('applies default confidence of 0.5 when omitted', () => {
    const { confidence, ...rest } = validInput;
    const result = brainPatternInputSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confidence).toBe(0.5);
    }
  });

  it('applies both defaults when supportingCases and confidence are omitted', () => {
    const { supportingCases, confidence, ...rest } = validInput;
    const result = brainPatternInputSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.supportingCases).toBe(1);
      expect(result.data.confidence).toBe(0.5);
    }
  });

  it('does not require id or timestamps', () => {
    const result = brainPatternInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('id' in result.data).toBe(false);
      expect('createdAt' in result.data).toBe(false);
      expect('updatedAt' in result.data).toBe(false);
    }
  });

  it('accepts optional relatedDiagnoses and relatedGenes', () => {
    const result = brainPatternInputSchema.safeParse({
      ...validInput,
      relatedDiagnoses: ['Q79.6'],
      relatedGenes: ['COL5A1'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required pattern field', () => {
    const { pattern, ...rest } = validInput;
    const result = brainPatternInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing sourceCaseLabels', () => {
    const { sourceCaseLabels, ...rest } = validInput;
    const result = brainPatternInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ─── brainPatternQuerySchema ─────────────────────────────────────────────

describe('brainPatternQuerySchema', () => {
  it('accepts a valid query with all fields', () => {
    const result = brainPatternQuerySchema.safeParse({
      symptoms: ['joint hypermobility', 'fatigue'],
      hpoTerms: ['HP:0001382'],
      category: 'diagnostic-shortcut',
      minConfidence: 0.7,
      limit: 10,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty query (all fields optional)', () => {
    const result = brainPatternQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts query with only symptoms', () => {
    const result = brainPatternQuerySchema.safeParse({
      symptoms: ['headache'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts query with only hpoTerms', () => {
    const result = brainPatternQuerySchema.safeParse({
      hpoTerms: ['HP:0001382', 'HP:0000974'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects limit < 1', () => {
    const result = brainPatternQuerySchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects limit > 50', () => {
    const result = brainPatternQuerySchema.safeParse({ limit: 51 });
    expect(result.success).toBe(false);
  });

  it('rejects minConfidence > 1', () => {
    const result = brainPatternQuerySchema.safeParse({ minConfidence: 1.1 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid category in query', () => {
    const result = brainPatternQuerySchema.safeParse({ category: 'bogus' });
    expect(result.success).toBe(false);
  });
});

// ─── caseResolutionSchema ────────────────────────────────────────────────

describe('caseResolutionSchema', () => {
  const validResolution = {
    caseLabel: 'case-marfan-042',
    phenotypeCluster: ['arachnodactyly', 'lens subluxation', 'tall stature'],
    initialHypotheses: [
      { diagnosis: 'Marfan syndrome', confidence: 70 },
      { diagnosis: 'Ehlers-Danlos syndrome', confidence: 20 },
    ],
    finalDiagnosis: 'Marfan syndrome',
    diagnosisConfidence: 95,
    keyDifferentiator: 'Lens subluxation is pathognomonic for Marfan, not EDS',
    misleadingFindings: ['Joint hypermobility suggested EDS initially'],
    diagnosticJourney: {
      timeToResolution: '3 months',
      totalResearchQueries: 42,
      pivotalMoment: 'Ophthalmology consult revealed lens subluxation',
    },
    treatmentOutcome: {
      drugClassesTried: ['beta-blockers', 'ARBs'],
      effectiveTreatment: 'Losartan 50mg daily',
      pharmacogenomicFactors: ['CYP2C9 normal metabolizer'],
    },
  };

  it('accepts a valid full resolution', () => {
    const result = caseResolutionSchema.safeParse(validResolution);
    expect(result.success).toBe(true);
  });

  it('accepts minimal resolution (caseLabel + phenotypeCluster + initialHypotheses)', () => {
    const result = caseResolutionSchema.safeParse({
      caseLabel: 'case-minimal-001',
      phenotypeCluster: ['fatigue'],
      initialHypotheses: [{ diagnosis: 'CFS', confidence: 50 }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts resolution with diagnosticJourney but no treatmentOutcome', () => {
    const result = caseResolutionSchema.safeParse({
      caseLabel: 'case-journey-001',
      phenotypeCluster: ['headache', 'photophobia'],
      initialHypotheses: [{ diagnosis: 'Migraine', confidence: 60 }],
      diagnosticJourney: {
        timeToResolution: '6 weeks',
        pivotalMoment: 'MRI revealed Chiari malformation',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts resolution with treatmentOutcome but no diagnosticJourney', () => {
    const result = caseResolutionSchema.safeParse({
      caseLabel: 'case-treatment-001',
      phenotypeCluster: ['joint pain'],
      initialHypotheses: [{ diagnosis: 'RA', confidence: 40 }],
      treatmentOutcome: {
        effectiveTreatment: 'Methotrexate 15mg weekly',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing caseLabel', () => {
    const { caseLabel, ...rest } = validResolution;
    const result = caseResolutionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing initialHypotheses', () => {
    const { initialHypotheses, ...rest } = validResolution;
    const result = caseResolutionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects hypothesis confidence > 100', () => {
    const result = caseResolutionSchema.safeParse({
      ...validResolution,
      initialHypotheses: [{ diagnosis: 'Test', confidence: 150 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects hypothesis confidence < 0', () => {
    const result = caseResolutionSchema.safeParse({
      ...validResolution,
      initialHypotheses: [{ diagnosis: 'Test', confidence: -10 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects diagnosisConfidence > 100', () => {
    const result = caseResolutionSchema.safeParse({
      ...validResolution,
      diagnosisConfidence: 101,
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty diagnosticJourney object', () => {
    const result = caseResolutionSchema.safeParse({
      caseLabel: 'case-empty-journey',
      phenotypeCluster: ['tremor'],
      initialHypotheses: [{ diagnosis: 'ET', confidence: 30 }],
      diagnosticJourney: {},
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty treatmentOutcome object', () => {
    const result = caseResolutionSchema.safeParse({
      caseLabel: 'case-empty-treatment',
      phenotypeCluster: ['tremor'],
      initialHypotheses: [{ diagnosis: 'ET', confidence: 30 }],
      treatmentOutcome: {},
    });
    expect(result.success).toBe(true);
  });
});
